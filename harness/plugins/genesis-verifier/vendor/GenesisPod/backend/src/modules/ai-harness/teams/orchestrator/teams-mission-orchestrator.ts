/**
 * AI Engine - Mission Orchestrator Implementation
 * 任务编排器实现
 *
 * 核心流程：Mission Input → Parse → Plan → Execute → Review → Deliver
 *
 * 集成：
 * - ConstraintEngine: 约束评估和成本追踪
 * - ToolRegistry: 内置工具调用
 * - SkillRegistry: 技能调用 ★ 新增
 * - LLMFactory: LLM 适配器
 * - MCPManager: MCP 外部工具
 * - Memory: 上下文管理
 * - HandoffCoordinator: Leader→Member 委派 ★ 新增
 */

import { Injectable, Logger, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { v4 as uuidv4 } from "uuid";
import { ITeam } from "../abstractions/team.interface";
import { RoleId } from "../abstractions/role.interface";
import { ITeamMember } from "../abstractions/member.interface";
import {
  MissionInput,
  MissionResult,
  MissionEvent,
  MissionEventType,
  ParsedIntent,
  MissionDeliverable,
  TaskType,
  ComplexityLevel,
} from "../../agents/abstractions/mission.types";
import {
  MissionExecutionProfile,
  ResourceUsage,
  mergeConstraintProfiles,
} from "../constraints";
import { ConstraintEngine } from "@/modules/ai-harness/guardrails/constraints/constraint-engine";
import {
  IMissionOrchestrator,
  MissionExecutionPlan,
  MissionExecutionState,
  ExecutionStep,
  StepReviewResult,
  OrchestratorConfig,
  OrchestratorPhase,
  DEFAULT_ORCHESTRATOR_CONFIG,
} from "./orchestrator.interface";
import { tryDynamicDecomposition, leafStepIds } from "./dynamic-planning";

// AI Engine 核心依赖
import { ToolRegistry } from "@/modules/ai-engine/tools/registry/tool.registry";
import { ToolPipeline } from "@/modules/ai-engine/tools/middleware/tool-pipeline";
import { SkillRegistry } from "@/modules/ai-engine/skills/registry/skill.registry";
import {
  SkillContext,
  SkillResult,
} from "@/modules/ai-engine/skills/abstractions/skill.interface";
import { LLMFactory } from "@/modules/ai-engine/llm/factory/llm.factory";
import { LLMToolDefinition } from "@/modules/ai-engine/llm/abstractions/llm-adapter.interface";
import { MCPManager } from "@/modules/ai-engine/tools/adapters/mcp/manager/mcp-manager";
import { ShortTermMemoryService } from "@/modules/ai-harness/memory/stores/short-term-memory.service";
import {
  HandoffCoordinator,
  HandoffContextBuilder,
} from "@/modules/ai-harness/teams/collaboration/patterns/handoff-pattern";
import { CollaborationMessage } from "@/modules/ai-harness/teams/collaboration/abstractions/collaborator.interface";
import { AiChatService } from "@/modules/ai-engine/llm/chat/ai-chat.service";
import {
  AiChatLLMAdapter,
  ISimpleLLMAdapter,
} from "@/modules/ai-engine/llm/adapters/ai-chat-llm.adapter";
import { PrismaService } from "@/common/prisma/prisma.service";
import { LruMap } from "@/common/utils/lru-map";
import { TraceCollectorService } from "@/modules/ai-harness/tracing/observability/trace-collector.service";
import { CheckpointManager } from "@/modules/ai-harness/protocols/journal/checkpoint-manager";
import { MessageBusService as A2AMessageBusService } from "@/modules/ai-harness/protocols/ipc/message-bus.service";
import {
  ExecutionContext,
  StepResult,
} from "@/modules/ai-harness/teams/orchestrator/workflow-orchestrator.interface";
import { MissionExecutorService } from "@/modules/ai-harness/lifecycle/manager/mission-executor.service";
import { EventJournalService } from "@/modules/ai-harness/protocols/journal/event-journal.service";
import { HierarchicalMemoryCascadeService } from "@/modules/ai-harness/memory/working/hierarchical-memory-cascade.service";
import {
  AgentLifecycleProtocolService,
  type TaskNotificationPayload,
} from "@/modules/ai-harness/protocols/ipc/agent-lifecycle-protocol.service";
import {
  AdaptiveReplannerService,
  type StepExecutionResult as ReplanStepExecutionResult,
} from "./adaptive-replanner.service";
import { MissionRuntimeStateStore } from "../../lifecycle/mission-lifecycle/runtime-state-store";

/**
 * 步骤执行结果（内部使用）
 */
interface StepExecutionResult {
  stepId: string;
  executor: string;
  output: unknown;
  skillResults?: Array<{ skillId: string; result: SkillResult }>;
  toolResults?: unknown[];
  timestamp: Date;
  tokensUsed: number;
  costUsed: number;
}

/**
 * 返工上下文
 */
interface ReworkContext {
  stepId: string;
  attempt: number;
  previousOutput: unknown;
  reviewFeedback: string;
  issues: string[];
}

/**
 * Mission 编排器实现
 */
@Injectable()
export class TeamsMissionOrchestrator implements IMissionOrchestrator {
  private readonly logger = new Logger(TeamsMissionOrchestrator.name);
  private readonly states = new Map<string, MissionExecutionState>();
  private readonly config: OrchestratorConfig;
  private readonly handoffCoordinator: HandoffCoordinator;

  // ★ A2A 消息总线（Agent 间通信，可选依赖）
  private readonly a2aBus?: A2AMessageBusService;

  // ★ 存储原始输入，不依赖 Memory 服务（修复数据丢失问题）
  private readonly originalInputs = new LruMap<string, MissionInput>(500);

  // ★ 存储任务的 traceId（用于 cancel 时清理）
  private readonly missionTraces = new LruMap<string, string>(500);

  // ★ LLM 适配器（用于 Skills 调用 LLM）
  private readonly llmAdapter?: ISimpleLLMAdapter;

  // ★ Trace 收集器（可选，用于执行链路可视化）
  private readonly traceCollector?: TraceCollectorService;

  // ★ Checkpoint 管理器（可选，用于自动保存检查点）
  private readonly checkpointManager?: CheckpointManager;

  // ★ AI Kernel 进程生命周期（可选，用于 Durable Execution）
  private readonly missionExecutor?: MissionExecutorService;
  private readonly kernelJournal?: EventJournalService;
  // ★ Phase 4: 自适应重规划（可选）
  private readonly adaptiveReplanner?: AdaptiveReplannerService;
  // ★ Phase 6: 分层记忆级联（可选）
  private readonly hierarchicalMemory?: HierarchicalMemoryCascadeService;
  // ★ Phase 8: Agent 生命周期协议（可选）
  private readonly lifecycleProtocol?: AgentLifecycleProtocolService;
  // missionId → kernel processId 映射
  private readonly kernelProcessIds = new LruMap<string, string>(500);

  // ★ 心跳定时器（pod-local，跟随 mission 生命周期）
  private readonly heartbeatTimers = new Map<string, NodeJS.Timeout>();

  // ★ Phase 9 (2026-04-30): 运行时状态外置 —— Redis 持久化，跨 pod 接管
  private readonly runtimeStore?: MissionRuntimeStateStore;

  // 2026-05-01 (PR-X-R): ToolPipeline 注入到支持 setToolPipeline() 的 skill
  private readonly toolPipeline?: ToolPipeline;

  constructor(
    private readonly constraintEngine: ConstraintEngine,
    private readonly configService: ConfigService,
    private readonly toolRegistry?: ToolRegistry,
    private readonly skillRegistry?: SkillRegistry,
    private readonly llmFactory?: LLMFactory,
    private readonly memoryService?: ShortTermMemoryService,
    private readonly mcpManager?: MCPManager,
    private readonly aiChatService?: AiChatService,
    private readonly prismaService?: PrismaService,
    traceCollector?: TraceCollectorService,
    checkpointManager?: CheckpointManager,
    a2aBus?: A2AMessageBusService,
    config?: Partial<OrchestratorConfig>,
    missionExecutor?: MissionExecutorService,
    kernelJournal?: EventJournalService,
    @Optional() adaptiveReplanner?: AdaptiveReplannerService,
    @Optional() hierarchicalMemory?: HierarchicalMemoryCascadeService,
    @Optional() lifecycleProtocol?: AgentLifecycleProtocolService,
    @Optional() runtimeStore?: MissionRuntimeStateStore,
    @Optional() toolPipeline?: ToolPipeline,
  ) {
    // 2026-05-01 (PR-X-R): 注入 ToolPipeline 到支持 setToolPipeline() 的 skill
    this.toolPipeline = toolPipeline;
    // ★ 运行时状态外置（可选 — 不存在时退化为单实例内存）
    this.runtimeStore = runtimeStore;
    this.config = { ...DEFAULT_ORCHESTRATOR_CONFIG, ...config };
    this.handoffCoordinator = new HandoffCoordinator({
      timeout: 60000,
      requireConfirmation: false,
      maxRetries: 2,
      autoFallback: true,
    });

    // ★ 创建 LLM 适配器（如果 AiChatService 可用）
    // 传递 PrismaService 以从数据库获取默认模型配置
    if (this.aiChatService) {
      this.llmAdapter = new AiChatLLMAdapter(
        this.aiChatService,
        this.configService,
        this.prismaService,
      );
      this.logger.log(
        "LLM adapter initialized with AiChatService, ConfigService and PrismaService",
      );
    }

    // ★ 存储 TraceCollector 引用（可选依赖）
    this.traceCollector = traceCollector;
    if (this.traceCollector) {
      this.logger.log(
        "TraceCollector initialized for execution instrumentation",
      );
    }

    // ★ 存储 CheckpointManager 引用（可选依赖）
    this.checkpointManager = checkpointManager;
    if (this.checkpointManager) {
      this.logger.log("CheckpointManager initialized for auto-checkpoint");
    }

    // ★ 存储 A2A Message Bus 引用（可选依赖）
    this.a2aBus = a2aBus;
    if (this.a2aBus) {
      this.logger.log(
        "A2AMessageBus initialized for inter-agent communication",
      );
    }

    // ★ AI Kernel 进程追踪（可选依赖）
    this.missionExecutor = missionExecutor;
    this.kernelJournal = kernelJournal;
    if (this.missionExecutor) {
      this.logger.log(
        "AI Kernel MissionExecutor initialized for durable execution",
      );
    }

    // ★ Phase 4: 自适应重规划（可选依赖）
    this.adaptiveReplanner = adaptiveReplanner;
    if (this.adaptiveReplanner) {
      this.logger.log("AdaptiveReplanner initialized for dynamic replanning");
    }

    // ★ Phase 6: 分层记忆级联（可选依赖）
    this.hierarchicalMemory = hierarchicalMemory;
    if (this.hierarchicalMemory) {
      this.logger.log(
        "HierarchicalMemoryCascade initialized for context resolution",
      );
    }

    // ★ Phase 8: Agent 生命周期协议（可选依赖）
    this.lifecycleProtocol = lifecycleProtocol;
    if (this.lifecycleProtocol) {
      this.logger.log(
        "AgentLifecycleProtocol initialized for task completion notifications",
      );
    }

    // ★ Phase 9: Mission 运行时状态外置
    if (this.runtimeStore) {
      this.logger.log(
        `MissionRuntimeStateStore initialized (podId=${this.runtimeStore.getPodId()}) — harness is now stateless across pods`,
      );
    }
  }

  // ==================== Runtime Store 同步辅助 ====================

  /** state 写入后同步到 store（fire-and-forget，失败不影响主流程） */
  private syncStateToStore(
    missionId: string,
    state: MissionExecutionState,
  ): void {
    if (!this.runtimeStore) return;
    void this.runtimeStore
      .setState(missionId, state)
      .catch((err) =>
        this.logger.debug(
          `[runtimeStore] setState(${missionId}) failed: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
  }

  /**
   * 启动 mission 时调用 —— 原先写 Redis 心跳（claimOrBeat），已移除。
   * Redis heartbeat 无活消费方（getHeartbeat 从未被路由/接管逻辑读取），
   * 回收权威 = DB heartbeatAt（MissionLivenessGuard），两者职责隔离。
   * 此方法保留占位，未来若要接入跨 pod 路由须先更新 liveness-reclaim-contract.spec.ts。
   */
  private startHeartbeat(_missionId: string): void {
    // No-op: Redis heartbeat removed (vestigial, zero routing consumers).
    // DB-only reclaim contract enforced by liveness-reclaim-contract.spec.ts.
  }

  /** mission 终态时调用 —— 清 runtime store 全部 key（含状态、输入、trace、kernel） */
  private stopHeartbeat(missionId: string): void {
    // Clear the heartbeatTimers entry (no timer is set since startHeartbeat is no-op,
    // but guard against any leftover from a prior code path)
    const timer = this.heartbeatTimers.get(missionId);
    if (timer) {
      clearInterval(timer);
      this.heartbeatTimers.delete(missionId);
    }
    if (!this.runtimeStore) return;
    void this.runtimeStore
      .clearAll(missionId)
      .catch((err) =>
        this.logger.debug(
          `[runtimeStore] clearAll(${missionId}) failed: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
  }

  /**
   * 执行 Mission（完整流程）
   */
  async *execute(
    input: MissionInput,
    team: ITeam,
    constraintOverrides?: Partial<MissionExecutionProfile>,
  ): AsyncGenerator<MissionEvent, MissionResult> {
    const missionId = uuidv4();
    const startTime = Date.now();

    // 合并约束配置
    const constraints = mergeConstraintProfiles(
      team.constraintProfile,
      constraintOverrides || {},
    );

    // 初始化状态
    const state = this.initializeState(missionId);
    this.states.set(missionId, state);
    this.syncStateToStore(missionId, state);

    // ★ 直接存储原始输入（不依赖 Memory 服务）
    this.originalInputs.set(missionId, input);
    if (this.runtimeStore) {
      void this.runtimeStore.setInput(missionId, input).catch(() => undefined);
    }

    // ★ 启动心跳（标识当前 pod 持有 mission，跨 pod 接管的依据）
    this.startHeartbeat(missionId);

    // ★ AI Kernel: 创建进程记录（Durable Execution）
    if (this.missionExecutor) {
      try {
        const kernelResult = await this.missionExecutor.execute({
          userId: "system",
          agentId: team.leader.role.id,
          teamSessionId: missionId,
          input: { prompt: input.prompt, requirements: input.requirements },
        });
        this.kernelProcessIds.set(missionId, kernelResult.processId);
        if (this.runtimeStore) {
          void this.runtimeStore
            .setKernelProcessId(missionId, kernelResult.processId)
            .catch(() => undefined);
        }
      } catch (err) {
        this.logger.warn(
          `[Kernel] Failed to spawn process for mission ${missionId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // 存储上下文到 Memory（可选，用于持久化）
    await this.storeContext(missionId, "input", input);

    // ★ 开始 Trace（用于执行链路可视化）
    const traceId = this.traceCollector?.startTrace({
      name: `Mission: ${input.prompt.slice(0, 50)}...`,
      type: "team_execution",
      metadata: {
        missionId,
        teamId: team.id,
        teamName: team.name,
        prompt: input.prompt,
        constraintProfile: constraints,
      },
    });

    if (traceId) {
      this.missionTraces.set(missionId, traceId);
      if (this.runtimeStore) {
        void this.runtimeStore
          .setTraceId(missionId, traceId)
          .catch(() => undefined);
      }
    }

    try {
      // 发送开始事件
      yield this.createEvent("mission_started", missionId, { input });

      // Phase 1: Parse - 解析意图
      yield this.createEvent("parsing_started", missionId);
      state.phase = "parsing";

      // ★ 开始 Parse span
      let parseSpanId: string | undefined;
      if (traceId) {
        parseSpanId = this.traceCollector?.addSpan(traceId, {
          name: "Parse Intent",
          type: "planning",
          metadata: { phase: "parsing" },
        });
      }

      const intent = await this.parse(input);
      // ★ 关键修复：确保 intent.missionId 与当前 missionId 一致
      // parse() 返回的 intent.missionId 可能是空字符串，需要覆盖
      intent.missionId = missionId;
      await this.storeContext(missionId, "intent", intent);

      // ★ Phase 6: HierarchicalMemoryCascade — resolve project/team context
      if (this.hierarchicalMemory) {
        const meta = input.metadata ?? {};
        const userId =
          typeof meta["userId"] === "string" ? meta["userId"] : undefined;
        const projectId =
          typeof meta["projectId"] === "string" ? meta["projectId"] : undefined;
        const teamId =
          typeof meta["teamId"] === "string" ? meta["teamId"] : undefined;
        if (userId) {
          const memContext = this.hierarchicalMemory.resolve({
            sessionId: missionId,
            projectId,
            teamId,
            orgId: userId,
            key: "research-context",
          });
          if (memContext) {
            this.logger.debug(
              `[execute] Loaded memory context from ${memContext.resolvedFrom} scope`,
            );
            // â˜… F6 Fix: Inject resolved memory into mission context so agents can use it
            if (typeof memContext.value === "string") {
              input.prompt = `[Context from ${memContext.resolvedFrom} memory]\n${memContext.value}\n\n${input.prompt}`;
            } else if (
              memContext.value &&
              typeof memContext.value === "object"
            ) {
              if (!input.metadata) input.metadata = {};
              input.metadata["resolvedMemoryContext"] = memContext.value;
            }
          }
        }
      }

      // â˜… ç»“æŸ Parse span
      if (parseSpanId) {
        this.traceCollector?.endSpan(parseSpanId, {
          status: "success",
          output: {
            taskType: intent.taskType,
            complexity: intent.complexity.overall,
          },
        });
      }

      // ★ 保存 checkpoint：解析完成
      void this.saveCheckpoint(missionId, team.workflow.id, "parse_complete", {
        taskType: intent.taskType,
        complexity: intent.complexity.overall,
        primaryGoal: intent.primaryGoal,
      });

      // ★ AI Kernel: 记录解析完成事件
      void this.recordKernelEvent(missionId, "phase:parse_complete", {
        taskType: intent.taskType,
        complexity: intent.complexity.overall,
      });

      yield this.createEvent("parsing_completed", missionId, { intent });
      this.syncStateToStore(missionId, state);

      // Phase 2: Plan - 生成执行计划
      yield this.createEvent("planning_started", missionId);
      state.phase = "planning";

      // ★ 开始 Planning span
      let planSpanId: string | undefined;
      if (traceId) {
        planSpanId = this.traceCollector?.addSpan(traceId, {
          name: "Generate Execution Plan",
          type: "planning",
          metadata: { phase: "planning", teamWorkflow: team.workflow.type },
        });
      }

      const plan = await this.plan(intent, team, constraints);
      await this.storeContext(missionId, "plan", plan);

      // â˜… ç»“æŸ Planning span
      if (planSpanId) {
        this.traceCollector?.endSpan(planSpanId, {
          status: "success",
          output: {
            stepCount: plan.steps.length,
            estimatedDuration: plan.estimatedDuration,
          },
        });
      }

      // ★ 保存 checkpoint：计划生成完成
      void this.saveCheckpoint(missionId, team.workflow.id, "plan_complete", {
        stepCount: plan.steps.length,
        estimatedDuration: plan.estimatedDuration,
        estimatedCost: plan.estimatedCost,
      });

      // ★ AI Kernel: 记录计划完成事件
      void this.recordKernelEvent(missionId, "phase:plan_complete", {
        stepCount: plan.steps.length,
        estimatedDuration: plan.estimatedDuration,
      });

      yield this.createEvent("planning_completed", missionId, { plan });
      this.syncStateToStore(missionId, state);

      // Phase 3: Execute - 执行计划（含委派和协作）
      state.phase = "executing";

      // ★ 开始 Execution span
      let execSpanId: string | undefined;
      if (traceId) {
        execSpanId = this.traceCollector?.addSpan(traceId, {
          name: "Execute Plan",
          type: "synthesis",
          metadata: { phase: "execution", taskCount: plan.steps.length },
        });
      }

      for await (const event of this.executePlan(plan, team, constraints)) {
        yield event;

        // 更新状态
        if (event.type === "step_completed") {
          state.completedSteps.push(event.data?.stepId as string);
          state.intermediateOutputs.set(
            event.data?.stepId as string,
            event.data?.output,
          );

          // ★ 同步技能结果到 intermediateOutputs（以技能 ID 为键）
          const stepOutput = event.data?.output as StepExecutionResult;
          if (stepOutput?.skillResults) {
            for (const { skillId, result } of stepOutput.skillResults) {
              if (result.success && result.data) {
                state.intermediateOutputs.set(skillId, result.data);
              }
            }
          }

          // ★ Phase 8: AgentLifecycleProtocol — notify task completion
          if (this.lifecycleProtocol) {
            const stepId = event.data?.stepId as string | undefined;
            const notifPayload: TaskNotificationPayload = {
              taskId: stepId ?? "",
              status: "completed",
              summary: `Step completed: ${stepId ?? "unknown"}`,
              tokensUsed: (stepOutput as unknown as { tokensUsed?: number })
                ?.tokensUsed,
            };
            void this.lifecycleProtocol.notifyTaskComplete(
              missionId,
              "mission-orchestrator",
              "leader",
              notifPayload,
            );
          }
        }
        if (event.type === "step_failed") {
          state.failedSteps.push(event.data?.stepId as string);
        }

        // 更新资源使用
        state.resourceUsage = this.updateResourceUsage(state, startTime);

        // ★ Phase 9: 每个 step 完成后同步到 runtime store（断点续跑用）
        this.syncStateToStore(missionId, state);

        // 检查约束
        const canContinue = this.constraintEngine.canContinue(
          constraints,
          state.resourceUsage,
        );
        if (!canContinue.canContinue) {
          throw new Error(canContinue.reason);
        }
      }

      // â˜… ç»“æŸ Execution span
      if (execSpanId) {
        this.traceCollector?.endSpan(execSpanId, {
          status: "success",
          output: {
            completedSteps: state.completedSteps.length,
            failedSteps: state.failedSteps.length,
          },
        });
      }

      // Phase 4: Review - 审核（含返工循环）
      if (constraints.quality.reviewRequired) {
        yield this.createEvent("review_started", missionId);
        state.phase = "reviewing";

        // ★ 开始 Review span
        let reviewSpanId: string | undefined;
        if (traceId) {
          reviewSpanId = this.traceCollector?.addSpan(traceId, {
            name: "Review & Rework",
            type: "review",
            metadata: {
              phase: "reviewing",
              stepsToReview: state.intermediateOutputs.size,
            },
          });
        }

        for (const [stepId, output] of state.intermediateOutputs) {
          // 跳过 delivery 步骤的审核
          if (stepId === "delivery") continue;

          let currentOutput = output;
          let attempt = 0;
          let reviewResult: StepReviewResult;

          // 返工循环
          do {
            reviewResult = await this.review(stepId, currentOutput, team);
            state.reviewResults.push(reviewResult);
            yield this.createEvent("review_completed", missionId, {
              reviewResult,
            });

            if (
              !reviewResult.passed &&
              attempt < constraints.quality.maxReworks
            ) {
              // ★ 真正的返工：重新执行步骤
              yield this.createEvent("rework_requested", missionId, {
                stepId,
                attempt: attempt + 1,
                reason: reviewResult.feedback,
              });

              const plan = (await this.getContext(missionId))
                .plan as MissionExecutionPlan;
              const step = plan.steps.find((s) => s.id === stepId);
              if (step) {
                const executor =
                  team.getMemberById(step.executor) || team.leader;
                const reworkContext: ReworkContext = {
                  stepId,
                  attempt: attempt + 1,
                  previousOutput: currentOutput,
                  reviewFeedback: reviewResult.feedback,
                  issues: [],
                };

                // 重新执行步骤
                const reworkResult = await this.executeStepWithRework(
                  step,
                  executor,
                  missionId,
                  state,
                  reworkContext,
                );
                currentOutput = reworkResult;
                state.intermediateOutputs.set(stepId, currentOutput);

                yield this.createEvent("rework_completed", missionId, {
                  stepId,
                  attempt: attempt + 1,
                  output: currentOutput,
                });
              }

              state.resourceUsage.reworkCount++;
              attempt++;
            }
          } while (
            !reviewResult.passed &&
            attempt < constraints.quality.maxReworks
          );
        }

        // â˜… ç»“æŸ Review span
        if (reviewSpanId) {
          this.traceCollector?.endSpan(reviewSpanId, {
            status: "success",
            output: {
              reviewCount: state.reviewResults.length,
              reworkCount: state.resourceUsage.reworkCount,
            },
          });
        }

        // ★ 保存 checkpoint：审核完成
        void this.saveCheckpoint(
          missionId,
          team.workflow.id,
          "review_complete",
          {
            reviewCount: state.reviewResults.length,
            passedCount: state.reviewResults.filter((r) => r.passed).length,
            reworkCount: state.resourceUsage.reworkCount,
          },
        );

        // ★ AI Kernel: 记录审核完成事件
        void this.recordKernelEvent(missionId, "phase:review_complete", {
          reviewCount: state.reviewResults.length,
          reworkCount: state.resourceUsage.reworkCount,
        });
      }

      // Phase 5: Deliver - 生成交付物（使用导出工具）
      yield this.createEvent("delivering_started", missionId);
      state.phase = "delivering";

      // ★ 开始 Delivery span
      let deliverSpanId: string | undefined;
      if (traceId) {
        deliverSpanId = this.traceCollector?.addSpan(traceId, {
          name: "Generate Deliverables",
          type: "synthesis",
          metadata: { phase: "delivering" },
        });
      }

      const deliverables = await this.deliver(state, team);
      state.deliverables = deliverables;

      // â˜… ç»“æŸ Delivery span
      if (deliverSpanId) {
        this.traceCollector?.endSpan(deliverSpanId, {
          status: "success",
          output: { deliverableCount: deliverables.length },
        });
      }

      for (const deliverable of deliverables) {
        yield this.createEvent("deliverable_ready", missionId, { deliverable });
      }

      // å®Œæˆ
      state.phase = "completed";
      const result = this.createResult(state, startTime, true);

      // ★ 结束 Trace（成功）
      if (traceId) {
        this.traceCollector?.endTrace(traceId, {
          status: "success",
        });
      }

      // ★ AI Kernel: 标记进程完成
      void this.completeKernelProcess(missionId, {
        completedSteps: state.completedSteps.length,
        failedSteps: state.failedSteps.length,
        durationMs: Date.now() - startTime,
      });

      yield this.createEvent("mission_completed", missionId, { result });

      // ★ 清理原始输入，防止内存泄漏
      this.originalInputs.delete(missionId);
      // ★ 停心跳 + 清 runtime store
      this.stopHeartbeat(missionId);

      return result;
    } catch (error) {
      state.phase = "failed";
      const errorMessage = (error as Error).message;

      // ★ 结束 Trace（失败）
      if (traceId) {
        this.traceCollector?.endTrace(traceId, {
          status: "error",
        });
      }

      // ★ AI Kernel: 标记进程失败
      void this.failKernelProcess(missionId, errorMessage);

      yield this.createEvent("mission_failed", missionId, {
        error: errorMessage,
      });

      // ★ 清理原始输入，防止内存泄漏
      this.originalInputs.delete(missionId);
      // ★ 停心跳 + 清 runtime store
      this.stopHeartbeat(missionId);

      return this.createResult(state, startTime, false, errorMessage);
    }
  }

  /**
   * 解析 Mission 意图
   */
  async parse(input: MissionInput): Promise<ParsedIntent> {
    this.logger.log("Parsing mission intent...");

    // 使用 LLM 进行意图解析（如果可用）
    const parsedByLLM = await this.parseWithLLM(input);
    if (parsedByLLM) {
      return parsedByLLM;
    }

    // 降级：使用规则解析
    const taskType = this.inferTaskType(input.prompt);
    const complexity = this.assessComplexity(input);

    return {
      id: uuidv4(),
      missionId: "",
      primaryGoal: input.prompt.slice(0, 100),
      secondaryGoals: input.requirements || [],
      extractedInfo: {
        topics: this.extractTopics(input.prompt),
        entities: [],
        language: "zh",
      },
      taskType,
      complexity,
      suggestedStrategy: {
        workflowType: complexity.overall === "high" ? "hybrid" : "sequential",
        memberConfig: [],
        needsIteration: complexity.overall !== "low",
        needsHumanReview: false,
        riskFactors: [],
      },
      confidence: 0.8,
    };
  }

  /**
   * 使用 LLM 解析意图
   * ★ 添加 30 秒超时，防止 parse 阶段无限挂起
   */
  private async parseWithLLM(
    input: MissionInput,
  ): Promise<ParsedIntent | null> {
    if (!this.llmFactory) return null;

    const adapter = this.llmFactory.getAdapter();
    if (!adapter) return null;

    // ★ 30 秒超时用于 parse 阶段
    const PARSE_TIMEOUT = 30000;

    try {
      const systemPrompt = `你是一个任务分析专家。分析用户输入，提取：
1. 主要目标
2. 次要目标
3. 任务类型（research/analysis/creation/design/debate/review/mixed）
4. 复杂度评估
5. 建议的执行策略

以 JSON 格式输出。
CRITICAL: Your entire response MUST be valid JSON only. No explanation, no markdown, no code blocks. Start with { and end with }.`;

      // ★ 使用 Promise.race 强制超时
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("Parse timeout")), PARSE_TIMEOUT);
      });

      const response = await Promise.race([
        adapter.chat({
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: input.prompt },
          ],
          model: this.llmFactory.getDefaultModel(),
          taskProfile: { creativity: "low", outputLength: "short" },
          responseFormat: "json",
        }),
        timeoutPromise,
      ]);

      // 记录成本
      if (response.usage) {
        this.constraintEngine.recordCost(
          "parse_intent",
          response.model || "unknown",
          response.usage.promptTokens || 0,
          response.usage.completionTokens || 0,
        );
      }

      // 解析 LLM 响应
      if (response.content) {
        const parsed = this.parseLLMResponse(response.content, input);
        if (parsed) {
          return parsed;
        }
      }
    } catch (error) {
      this.logger.warn(
        `LLM parsing failed: ${(error as Error).message}, falling back to rules`,
      );
    }

    return null;
  }

  /**
   * 解析 LLM 响应
   */
  private parseLLMResponse(
    content: string,
    input: MissionInput,
  ): ParsedIntent | null {
    try {
      // Try direct parse first (JSON mode response), then fall back to extraction
      let parsed: ReturnType<typeof JSON.parse>;
      try {
        parsed = JSON.parse(content.trim());
      } catch {
        parsed = JSON.parse(this.extractFirstJsonObject(content) ?? "null");
      }
      const taskType = this.inferTaskType(input.prompt);
      const complexity = this.assessComplexity(input);

      return {
        id: uuidv4(),
        missionId: "",
        primaryGoal: parsed.primaryGoal || input.prompt.slice(0, 100),
        secondaryGoals: parsed.secondaryGoals || input.requirements || [],
        extractedInfo: {
          topics: parsed.topics || this.extractTopics(input.prompt),
          entities: parsed.entities || [],
          language: parsed.language || "zh",
        },
        taskType: parsed.taskType || taskType,
        complexity: {
          overall: parsed.complexity?.overall || complexity.overall,
          informational: complexity.informational,
          logical: complexity.logical,
          creative: complexity.creative,
          estimatedSubTasks:
            parsed.estimatedSubTasks || complexity.estimatedSubTasks,
          estimatedDuration: complexity.estimatedDuration,
          estimatedCost: complexity.estimatedCost,
        },
        suggestedStrategy: {
          workflowType: parsed.workflowType || "sequential",
          memberConfig: [],
          needsIteration: parsed.needsIteration ?? true,
          needsHumanReview: parsed.needsHumanReview ?? false,
          riskFactors: parsed.riskFactors || [],
        },
        confidence: 0.9,
      };
    } catch {
      return null;
    }
  }

  /**
   * 生成执行计划
   */
  async plan(
    intent: ParsedIntent,
    team: ITeam,
    constraints: MissionExecutionProfile,
  ): Promise<MissionExecutionPlan> {
    this.logger.log("Generating execution plan...");

    const steps: ExecutionStep[] = [];
    const workflow = team.workflow;

    // T6 (G1 动态规划): high-complexity 任务尝试 LLM 动态分解；
    // flag HARNESS_DYNAMIC_PLANNING 默认 off + 静态 workflow 兜底，零现网行为变更。
    const dynamicSteps = await tryDynamicDecomposition(
      intent,
      team,
      constraints,
      {
        estimateStepDuration: (t, d) => this.estimateStepDuration(t, d),
        estimateStepCost: (dur, mp) => this.estimateStepCost(dur, mp),
      },
      this.logger,
    );
    if (dynamicSteps) {
      steps.push(...dynamicSteps);
    } else {
      // 基于工作流生成步骤（静态默认路径）
      for (const workflowStep of workflow.steps) {
        const executors = workflowStep.executorRoles.map((roleId: RoleId) => {
          const members = team.getMembersByRole(roleId);
          return members[0]?.id || roleId;
        });

        const stepDuration = this.estimateStepDuration(
          workflowStep.type,
          constraints.quality.depth,
        );
        const stepCost = this.estimateStepCost(
          stepDuration,
          constraints.cost.modelPreference,
        );

        steps.push({
          id: workflowStep.id,
          name: workflowStep.name,
          description: workflowStep.description,
          executor: executors[0],
          type: this.mapStepType(workflowStep.type),
          dependencies: workflowStep.dependsOn,
          estimatedDuration: stepDuration,
          estimatedCost: stepCost,
          // ★ 包含工作流配置的超时时间，用于强制执行超时
          timeout: workflowStep.timeout,
        });
      }
    }

    // review/delivery 的终止依赖：静态线性 workflow 沿用"最后一步"（行为不变）；
    // 动态分解可能有并行分支 → 依赖所有叶子步骤，否则 delivery 会早于部分分支完成。
    const terminalDeps = dynamicSteps
      ? leafStepIds(steps)
      : [steps[steps.length - 1].id];

    // 添加审核步骤
    if (constraints.quality.reviewRequired) {
      steps.push({
        id: "review",
        name: "质量审核",
        description: "Leader 审核所有输出",
        executor: team.leader.id,
        type: "review",
        dependencies: terminalDeps,
        estimatedDuration: 60000,
        estimatedCost: 10,
      });
    }

    // 添加交付步骤
    steps.push({
      id: "delivery",
      name: "生成交付物",
      description: "整合结果并生成最终交付物",
      executor: team.leader.id,
      type: "delivery",
      dependencies: constraints.quality.reviewRequired
        ? ["review"]
        : terminalDeps,
      estimatedDuration: 30000,
      estimatedCost: 5,
    });

    const totalCost = steps.reduce((sum, s) => sum + s.estimatedCost, 0);
    const totalDuration = this.calculateTotalDuration(steps);

    return {
      id: uuidv4(),
      missionId: intent.missionId,
      parsedIntent: intent,
      steps,
      estimatedCost: totalCost,
      estimatedDuration: totalDuration,
      createdAt: new Date(),
    };
  }

  /**
   * 执行计划 - ★ 支持真正并行执行
   */
  async *executePlan(
    plan: MissionExecutionPlan,
    team: ITeam,
    constraints: MissionExecutionProfile,
  ): AsyncGenerator<MissionEvent, MissionExecutionState> {
    const missionId = plan.missionId;
    const state = this.states.get(missionId) || this.initializeState(missionId);
    const completedSteps = new Set<string>();
    const iterationStartTime = Date.now();
    // T7 (G1): bound adaptive replanning per mission to avoid fail→replan→fail loops.
    const MAX_REPLANS = 2;
    let replanCount = 0;

    // 按拓扑顺序执行步骤
    while (completedSteps.size < plan.steps.length) {
      // â˜… Constraint Profile: Budget checks at iteration boundaries
      const elapsed = Date.now() - iterationStartTime;
      const timeLimit = constraints.efficiency?.maxDuration || Infinity;

      if (elapsed > timeLimit * 0.8) {
        this.logger.warn(
          `[executePlan] Approaching time limit: ${elapsed}ms / ${timeLimit}ms (${Math.round((elapsed / timeLimit) * 100)}%)`,
        );
      }

      if (elapsed > timeLimit) {
        this.logger.error(
          `[executePlan] Time limit exceeded (${elapsed}ms > ${timeLimit}ms), stopping execution`,
        );
        throw new Error(
          `Mission execution time limit exceeded: ${elapsed}ms > ${timeLimit}ms`,
        );
      }

      // Check cost budget if available
      const costBudget = constraints.cost?.budget || Infinity;
      if (state.resourceUsage.costUsed > costBudget * 0.8) {
        this.logger.warn(
          `[executePlan] Approaching cost budget: ${state.resourceUsage.costUsed} / ${costBudget}`,
        );
      }

      if (state.resourceUsage.costUsed > costBudget) {
        this.logger.error(
          `[executePlan] Cost budget exceeded, stopping execution`,
        );
        throw new Error(
          `Mission cost budget exceeded: ${state.resourceUsage.costUsed} > ${costBudget}`,
        );
      }
      // 找出可执行的步骤（依赖已完成）
      const executableSteps = plan.steps.filter((step) => {
        if (completedSteps.has(step.id)) return false;
        return step.dependencies.every((dep) => completedSteps.has(dep));
      });

      if (
        executableSteps.length === 0 &&
        completedSteps.size < plan.steps.length
      ) {
        throw new Error("Deadlock detected: no executable steps available");
      }

      // ★ 真正并行执行：使用 Promise.all
      if (this.config.enableParallel && executableSteps.length > 1) {
        // 发送所有步骤开始事件
        for (const step of executableSteps) {
          state.currentSteps.push(step.id);
          yield this.createEvent("step_started", missionId, {
            stepId: step.id,
            message: `开始执行: ${step.name}`,
            parallel: true,
          });
        }

        // 并行执行所有步骤
        const executionPromises = executableSteps.map(async (step) => {
          const executor = team.getMemberById(step.executor) || team.leader;

          // ★ 使用 HandoffCoordinator 进行委派
          if (!executor.isLeader()) {
            await this.delegateToMember(team.leader, executor, step, missionId);
          }

          // ★ 使用超时包装器，防止 LLM 调用无限挂起
          return this.executeStepWithTimeout(
            step,
            executor,
            missionId,
            state,
            constraints,
          );
        });

        const results = await Promise.allSettled(executionPromises);

        // 处理结果
        for (let i = 0; i < results.length; i++) {
          const step = executableSteps[i];
          const result = results[i];

          state.currentSteps = state.currentSteps.filter(
            (id) => id !== step.id,
          );

          if (result.status === "fulfilled") {
            completedSteps.add(step.id);
            state.completedSteps.push(step.id);
            state.intermediateOutputs.set(step.id, result.value);

            // ★ 关键修复：同时以技能 ID 为键存储技能结果
            // 技能的 normalizeInput 需要通过 skillId 查找前置技能的输出
            const stepResult = result.value;
            if (stepResult.skillResults) {
              for (const {
                skillId,
                result: skillResult,
              } of stepResult.skillResults) {
                if (skillResult.success && skillResult.data) {
                  state.intermediateOutputs.set(skillId, skillResult.data);
                  this.logger.debug(
                    `[executePlan] Stored skill output for ${skillId}`,
                  );
                }
              }
            }

            yield this.createEvent("step_completed", missionId, {
              stepId: step.id,
              output: result.value,
            });

            // ★ 保存 checkpoint：步骤完成
            const context = await this.getContext(missionId);
            const plan = context.plan as MissionExecutionPlan;
            void this.saveCheckpoint(
              missionId,
              team.workflow.id,
              `step_${step.id}_complete`,
              {
                stepId: step.id,
                stepName: step.name,
                completedSteps: state.completedSteps.length,
                totalSteps: plan.steps.length,
                progress: state.completedSteps.length / plan.steps.length,
              },
            );
          } else {
            state.failedSteps.push(step.id);
            yield this.createEvent("step_failed", missionId, {
              stepId: step.id,
              error: result.reason?.message || "Unknown error",
            });

            if (!this.config.enableAutoRetry) {
              throw result.reason;
            }
          }
        }
      } else {
        // 顺序执行
        const step = executableSteps[0];
        state.currentSteps.push(step.id);
        yield this.createEvent("step_started", missionId, {
          stepId: step.id,
          message: `开始执行: ${step.name}`,
        });

        try {
          const executor = team.getMemberById(step.executor) || team.leader;

          // ★ 使用 HandoffCoordinator 进行委派
          if (!executor.isLeader()) {
            await this.delegateToMember(team.leader, executor, step, missionId);
          }

          // ★ 使用超时包装器，防止 LLM 调用无限挂起
          const output = await this.executeStepWithTimeout(
            step,
            executor,
            missionId,
            state,
            constraints,
          );

          completedSteps.add(step.id);
          state.currentSteps = state.currentSteps.filter(
            (id) => id !== step.id,
          );
          state.completedSteps.push(step.id);
          state.intermediateOutputs.set(step.id, output);

          // ★ 关键修复：同时以技能 ID 为键存储技能结果
          if (output.skillResults) {
            for (const {
              skillId,
              result: skillResult,
            } of output.skillResults) {
              if (skillResult.success && skillResult.data) {
                state.intermediateOutputs.set(skillId, skillResult.data);
                this.logger.debug(
                  `[executePlan] Stored skill output for ${skillId}`,
                );
              }
            }
          }

          yield this.createEvent("step_completed", missionId, {
            stepId: step.id,
            output,
          });

          // ★ 保存 checkpoint：步骤完成（顺序执行）
          const context = await this.getContext(missionId);
          const plan = context.plan as MissionExecutionPlan;
          void this.saveCheckpoint(
            missionId,
            team.workflow.id,
            `step_${step.id}_complete`,
            {
              stepId: step.id,
              stepName: step.name,
              completedSteps: state.completedSteps.length,
              totalSteps: plan.steps.length,
              progress: state.completedSteps.length / plan.steps.length,
            },
          );
        } catch (error) {
          state.failedSteps.push(step.id);
          state.currentSteps = state.currentSteps.filter(
            (id) => id !== step.id,
          );

          yield this.createEvent("step_failed", missionId, {
            stepId: step.id,
            error: (error as Error).message,
          });

          // â˜… Phase 4: Check if replanning is needed after step failure
          if (this.adaptiveReplanner) {
            const trigger = {
              type: "task_failed" as const,
              taskId: step.id,
              details: (error as Error).message ?? "Step failed",
            };
            // Map local ExecutionStep[] to AdaptiveReplanner's ExecutionStep[] by
            // adding the required `status` field (steps here are either pending or failed).
            const replanSteps = plan.steps.map((s) => ({
              ...s,
              status: (state.failedSteps.includes(s.id)
                ? "failed"
                : state.completedSteps.includes(s.id)
                  ? "completed"
                  : "pending") as
                | "pending"
                | "running"
                | "completed"
                | "failed"
                | "skipped",
            }));
            const currentPlan = {
              steps: replanSteps,
              totalSteps: plan.steps.length,
              completedSteps: completedSteps.size,
            };
            const executionHistory: ReplanStepExecutionResult[] =
              state.completedSteps.map((id) => ({
                stepId: id,
                success: true,
              }));
            const shouldReplan = this.adaptiveReplanner.shouldReplan(
              trigger,
              currentPlan,
              executionHistory,
            );
            // T7 (G1): apply the replan to the live plan, bounded by a replan
            // budget to prevent fail → replan → fail loops.
            if (shouldReplan && replanCount < MAX_REPLANS) {
              replanCount++;
              const replanResult = this.adaptiveReplanner.replan(
                trigger,
                currentPlan,
                executionHistory,
              );
              const { added, removed } = this.adaptiveReplanner.applyToPlan(
                plan,
                replanResult,
                {
                  completedStepIds: completedSteps,
                  runningStepIds: new Set(state.currentSteps),
                },
              );
              this.logger.log(
                `[MissionOrchestrator] Replan #${replanCount} applied (+${added.length}/-${removed.length}): ${replanResult.reasoning}`,
              );
            } else if (shouldReplan) {
              this.logger.warn(
                `[MissionOrchestrator] Replan budget exhausted (${MAX_REPLANS}); not replanning further`,
              );
            }
          }

          if (!this.config.enableAutoRetry) {
            throw error;
          }
        }
      }
    }

    return state;
  }

  /**
   * ★ 委派任务给成员（使用 HandoffCoordinator）
   */
  private async delegateToMember(
    leader: ITeamMember,
    member: ITeamMember,
    step: ExecutionStep,
    missionId: string,
  ): Promise<void> {
    const context = new HandoffContextBuilder()
      .withTask({
        id: step.id,
        description: step.description,
        progress: 0,
      })
      .withConstraints([
        `执行者角色: ${member.role.name}`,
        `可用技能: ${member.skills.join(", ")}`,
      ])
      .build();

    const handoffResponse = await this.handoffCoordinator.initiateHandoff(
      {
        fromAgentId: leader.id,
        toAgentId: member.id,
        reason: `执行步骤: ${step.name}`,
        context,
      },
      // 发送消息回调：通过 A2A Bus 广播 handoff 消息
      async (msg: CollaborationMessage) => {
        this.logger.debug(`Handoff message: ${leader.id} → ${member.id}`);
        void this.a2aBus?.publish({
          sessionId: missionId,
          fromAgentId: leader.id,
          toAgentId: member.id,
          type: "task_request",
          payload: msg,
        });
      },
      // 等待响应回调
      async (_fromAgentId: string, _timeout: number) => {
        // 模拟成员接受任务
        return { accepted: true, message: "任务已接受" };
      },
    );

    if (!handoffResponse.accepted) {
      this.logger.warn(
        `Member ${member.id} rejected task: ${handoffResponse.message}`,
      );
    }
  }

  /**
   * ★ 步骤执行超时包装器
   * 使用 Promise.race 强制执行超时，防止 LLM 调用无限挂起
   */
  private async executeStepWithTimeout(
    step: ExecutionStep,
    executor: ITeamMember,
    missionId: string,
    state: MissionExecutionState,
    constraints: MissionExecutionProfile,
  ): Promise<StepExecutionResult> {
    // 获取超时时间：步骤配置 > 默认 60 秒
    const timeout = step.timeout || 60000;

    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(
          new Error(
            `步骤 "${step.name}" 执行超时 (${timeout / 1000}s)。这可能是因为 AI 模型响应缓慢或网络问题。`,
          ),
        );
      }, timeout);
    });

    try {
      // 使用 Promise.race 强制超时
      return await Promise.race([
        this.executeStepFull(step, executor, missionId, state, constraints),
        timeoutPromise,
      ]);
    } catch (error) {
      // 超时或其他错误，返回失败结果（符合 StepExecutionResult 接口）
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[executeStepWithTimeout] ${step.id} failed: ${errorMessage}`,
      );

      return {
        stepId: step.id,
        executor: executor.id,
        output: `执行失败: ${errorMessage}`,
        timestamp: new Date(),
        tokensUsed: 0,
        costUsed: 0,
      };
    }
  }

  /**
   * ★ 完整执行步骤（集成 Skills + Tools + LLM）
   */
  private async executeStepFull(
    step: ExecutionStep,
    executor: ITeamMember,
    missionId: string,
    state: MissionExecutionState,
    constraints: MissionExecutionProfile,
  ): Promise<StepExecutionResult> {
    const context = await this.getContext(missionId);
    let totalTokens = 0;
    let totalCost = 0;

    // ★ 优先使用直接存储的原始输入（不依赖 Memory 服务）
    const originalInput = this.originalInputs.get(missionId);
    const missionInput =
      originalInput || (context.input as MissionInput | undefined);

    // ★ 调试日志：确认数据来源
    if (!missionInput) {
      this.logger.warn(
        `[executeStepFull] No MissionInput found for ${missionId}. originalInput: ${!!originalInput}, context.input: ${!!context.input}`,
      );
    } else {
      this.logger.debug(
        `[executeStepFull] MissionInput found. sourceText length: ${(missionInput.metadata?.context as string)?.length || 0}`,
      );
    }

    // ★ 1. 执行 Member 的技能
    const skillResults: Array<{ skillId: string; result: SkillResult }> = [];
    if (this.skillRegistry && executor.skills.length > 0) {
      for (const skillId of executor.skills) {
        const skill = this.skillRegistry.tryGet(skillId);
        if (skill) {
          // ★ 关键修复：为技能设置 LLM 适配器
          // Skills 通过 callLLM() 调用 LLM，需要先设置 adapter
          if (this.llmAdapter && "setLLMAdapter" in skill) {
            (
              skill as { setLLMAdapter: (adapter: ISimpleLLMAdapter) => void }
            ).setLLMAdapter(this.llmAdapter);
            this.logger.debug(
              `[executeStepFull] Set LLM adapter for skill ${skillId}`,
            );
          } else if (!this.llmAdapter) {
            this.logger.warn(
              `[executeStepFull] No LLM adapter available for skill ${skillId}`,
            );
          }
          // 2026-05-01 (PR-X-R): inject ToolPipeline if skill supports it
          if (this.toolPipeline && "setToolPipeline" in skill) {
            (
              skill as { setToolPipeline: (p: ToolPipeline) => void }
            ).setToolPipeline(this.toolPipeline);
          }

          try {
            // ★ 优先使用 missionInput.metadata.sessionId（Slides 等应用传入的实际会话 ID）
            // 否则回退到 missionId（默认行为）
            const actualSessionId =
              (missionInput?.metadata?.sessionId as string) || missionId;

            const skillContext: SkillContext = {
              executionId: uuidv4(),
              skillId: skill.id,
              domain: skill.domain,
              callerId: executor.id,
              sessionId: actualSessionId,
              createdAt: new Date(),
            };

            // ★ 构建技能输入 - 从 metadata.context 提取 sourceText
            // 数据流：SlidesEngineService 的 context: input.sourceText
            //        → TeamsService çš„ metadata.context
            //        → 这里提取到 skillInput.context.input.sourceText
            const sourceText =
              (missionInput?.metadata?.context as string) || "";
            const userRequirement = missionInput?.prompt || "";

            if (!sourceText) {
              this.logger.warn(
                `[executeStepFull] sourceText is empty! metadata: ${JSON.stringify(missionInput?.metadata || {})}`,
              );
            }

            const skillInput = {
              task: step.description,
              context: {
                ...context,
                input: {
                  // ★ 将 metadata 中的字段提升到 input 层级，便于技能访问
                  sourceText,
                  userRequirement,
                  targetPages: missionInput?.metadata?.targetPages as
                    | number
                    | undefined,
                  stylePreference: missionInput?.metadata?.stylePreference as
                    | string
                    | undefined,
                  targetAudience: missionInput?.metadata?.targetAudience as
                    | string
                    | undefined,
                  themeId: missionInput?.metadata?.themeId as
                    | string
                    | undefined,
                  sessionId: missionInput?.metadata?.sessionId as
                    | string
                    | undefined,
                  // 保留原始 input 作为 _raw
                  _raw: missionInput,
                },
              },
              previousOutputs: Object.fromEntries(state.intermediateOutputs),
            };

            this.logger.debug(`Executing skill ${skillId} for step ${step.id}`);
            const result = await skill.execute(skillInput, skillContext);
            skillResults.push({ skillId, result });

            if (result.metadata.tokensUsed) {
              totalTokens += result.metadata.tokensUsed;
            }
          } catch (error) {
            this.logger.warn(
              `Skill ${skillId} execution failed: ${(error as Error).message}`,
            );
          }
        }
      }
    }

    // ★ 2. 使用 LLM 执行（融合技能结果和人设）
    let llmOutput: string | undefined;
    let toolResults: unknown[] = [];

    if (this.llmFactory) {
      const adapter = this.llmFactory.getAdapter();
      if (adapter) {
        try {
          // ★ 构建融合人设的系统提示词
          const systemPrompt = this.buildSystemPromptWithPersona(executor);

          // ★ 构建融合技能结果的用户提示词
          const userPrompt = this.buildStepPromptWithSkills(
            step,
            context,
            skillResults,
          );

          // 收集可用工具
          const tools = await this.collectAvailableTools(executor);

          const response = await adapter.chat({
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
            model: executor.model,
            taskProfile: {
              creativity: this.mapWorkStyleToCreativity(executor.workStyle),
              outputLength: this.mapDepthToOutputLength(
                constraints.quality.depth,
                executor.workStyle,
              ),
            },
            tools: tools.length > 0 ? tools : undefined,
          });

          llmOutput = response.content ?? undefined;

          // 记录成本
          if (response.usage) {
            const cost = this.constraintEngine.recordCost(
              `step_${step.id}`,
              response.model || executor.model,
              response.usage.promptTokens || 0,
              response.usage.completionTokens || 0,
              missionId,
            );
            totalCost += cost;
            totalTokens +=
              (response.usage.promptTokens || 0) +
              (response.usage.completionTokens || 0);
          }

          // 处理工具调用
          if (response.toolCalls && response.toolCalls.length > 0) {
            toolResults = await this.handleToolCalls(response.toolCalls);
          }
        } catch (error) {
          this.logger.error(
            `LLM execution failed for step ${step.id}: ${(error as Error).message}`,
          );
        }
      }
    }

    // 更新状态
    state.resourceUsage.tokensUsed += totalTokens;
    state.resourceUsage.costUsed += totalCost;

    // 如果没有 LLM 输出，使用技能结果或模拟
    if (!llmOutput) {
      if (skillResults.length > 0) {
        llmOutput = skillResults
          .map((r) => JSON.stringify(r.result.data))
          .join("\n");
      } else {
        llmOutput = `Step ${step.name} completed by ${executor.name} (simulated)`;
      }
    }

    return {
      stepId: step.id,
      executor: executor.id,
      output: llmOutput,
      skillResults: skillResults.length > 0 ? skillResults : undefined,
      toolResults: toolResults.length > 0 ? toolResults : undefined,
      timestamp: new Date(),
      tokensUsed: totalTokens,
      costUsed: totalCost,
    };
  }

  /**
   * ★ 带返工上下文执行步骤
   */
  private async executeStepWithRework(
    step: ExecutionStep,
    executor: ITeamMember,
    missionId: string,
    state: MissionExecutionState,
    reworkContext: ReworkContext,
  ): Promise<StepExecutionResult> {
    const context = await this.getContext(missionId);
    let totalTokens = 0;
    let totalCost = 0;

    if (this.llmFactory) {
      const adapter = this.llmFactory.getAdapter();
      if (adapter) {
        try {
          const systemPrompt = this.buildSystemPromptWithPersona(executor);

          // ★ 构建返工提示词（包含审核反馈）
          const userPrompt = this.buildReworkPrompt(
            step,
            context,
            reworkContext,
          );

          const response = await adapter.chat({
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userPrompt },
            ],
            model: executor.model,
            taskProfile: { creativity: "low", outputLength: "medium" },
          });

          if (response.usage) {
            const cost = this.constraintEngine.recordCost(
              `rework_${step.id}_${reworkContext.attempt}`,
              response.model || executor.model,
              response.usage.promptTokens || 0,
              response.usage.completionTokens || 0,
              missionId,
            );
            totalCost += cost;
            totalTokens +=
              (response.usage.promptTokens || 0) +
              (response.usage.completionTokens || 0);
          }

          state.resourceUsage.tokensUsed += totalTokens;
          state.resourceUsage.costUsed += totalCost;

          return {
            stepId: step.id,
            executor: executor.id,
            output: response.content,
            timestamp: new Date(),
            tokensUsed: totalTokens,
            costUsed: totalCost,
          };
        } catch (error) {
          this.logger.error(
            `Rework failed for step ${step.id}: ${(error as Error).message}`,
          );
        }
      }
    }

    // é™çº§
    return {
      stepId: step.id,
      executor: executor.id,
      output: `Rework for step ${step.name} (simulated)`,
      timestamp: new Date(),
      tokensUsed: 0,
      costUsed: 0,
    };
  }

  /**
   * ★ 构建融合人设的系统提示词
   */
  private buildSystemPromptWithPersona(executor: ITeamMember): string {
    let prompt = executor.getSystemPrompt();

    // ★ 融合人设
    if (executor.persona) {
      prompt = `${executor.persona}\n\n${prompt}`;
    }

    // ★ 融合工作风格
    const workStyle = executor.workStyle;
    if (workStyle) {
      const styleHints: string[] = [];

      // outputStyle maps to response length/detail
      if (workStyle.outputStyle === "detailed") {
        styleHints.push("请提供详尽、全面的分析和输出");
      } else if (workStyle.outputStyle === "concise") {
        styleHints.push("请保持简洁明了，突出重点");
      }

      // thinkingDepth affects depth of analysis
      if (workStyle.thinkingDepth === "deep") {
        styleHints.push("进行深入分析，考虑多种角度");
      } else if (workStyle.thinkingDepth === "quick") {
        styleHints.push("快速响应，聚焦核心问题");
      }

      // riskTolerance affects creativity level
      if (workStyle.riskTolerance === "aggressive") {
        styleHints.push("鼓励创新思维和独特见解");
      } else if (workStyle.riskTolerance === "conservative") {
        styleHints.push("保持严谨，基于事实和证据");
      }

      if (styleHints.length > 0) {
        prompt += `\n\n## 工作风格\n${styleHints.join("\n")}`;
      }
    }

    return prompt;
  }

  /**
   * ★ 构建融合技能结果的用户提示词
   */
  private buildStepPromptWithSkills(
    step: ExecutionStep,
    context: Record<string, unknown>,
    skillResults: Array<{ skillId: string; result: SkillResult }>,
  ): string {
    let prompt = `## 当前任务\n${step.description}\n\n`;

    if (context.intent) {
      prompt += `## 任务目标\n${JSON.stringify(context.intent, null, 2)}\n\n`;
    }

    if (
      context.previousOutputs &&
      Object.keys(context.previousOutputs as object).length > 0
    ) {
      prompt += `## 前序步骤输出\n${JSON.stringify(context.previousOutputs, null, 2)}\n\n`;
    }

    // ★ 融合技能执行结果
    if (skillResults.length > 0) {
      prompt += `## 技能分析结果\n`;
      for (const { skillId, result } of skillResults) {
        if (result.success && result.data) {
          prompt += `### ${skillId}\n${JSON.stringify(result.data, null, 2)}\n\n`;
        }
      }
    }

    prompt += `请根据上述信息完成任务，输出高质量的结果。`;

    return prompt;
  }

  /**
   * ★ 构建返工提示词
   */
  private buildReworkPrompt(
    step: ExecutionStep,
    _context: Record<string, unknown>,
    reworkContext: ReworkContext,
  ): string {
    let prompt = `## 任务返工（第 ${reworkContext.attempt} 次）\n\n`;
    prompt += `### 原任务\n${step.description}\n\n`;
    prompt += `### 上次输出\n${JSON.stringify(reworkContext.previousOutput, null, 2)}\n\n`;
    prompt += `### 审核反馈\n${reworkContext.reviewFeedback}\n\n`;

    if (reworkContext.issues.length > 0) {
      prompt += `### 需要修正的问题\n`;
      for (const issue of reworkContext.issues) {
        prompt += `- ${issue}\n`;
      }
      prompt += `\n`;
    }

    prompt += `请根据审核反馈修正输出，解决上述问题。`;

    return prompt;
  }

  /**
   * 根据工作风格映射 creativity 等级（用于 taskProfile）
   */
  private mapWorkStyleToCreativity(
    workStyle: ITeamMember["workStyle"],
  ): "low" | "medium" | "high" {
    if (!workStyle) return "medium";
    if (workStyle.riskTolerance === "aggressive") return "high";
    if (workStyle.riskTolerance === "conservative") return "low";
    return "medium";
  }

  /**
   * 从 LLM 输出中提取第一个完整 JSON 对象（balanced-brace 算法）
   * 解决 firstBrace/lastBrace 在多 JSON 对象时截取错误的问题
   */
  private extractFirstJsonObject(content: string): string | null {
    const start = content.indexOf("{");
    if (start === -1) return null;
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < content.length; i++) {
      const ch = content[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\" && inString) {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) return content.slice(start, i + 1);
      }
    }
    return null;
  }

  /**
   * 根据质量深度映射 outputLength（用于 taskProfile）
   * depth 为主信号；standard 时用 workStyle.outputStyle 作为 tiebreaker
   */
  private mapDepthToOutputLength(
    depth: MissionExecutionProfile["quality"]["depth"],
    workStyle?: ITeamMember["workStyle"],
  ): "short" | "medium" | "long" {
    if (depth === "comprehensive") return "long";
    if (depth === "quick") return "short";
    // standard → 用 outputStyle 细化
    if (workStyle?.outputStyle === "detailed") return "long";
    if (workStyle?.outputStyle === "concise") return "short";
    return "medium";
  }

  /**
   * 收集可用工具
   */
  private async collectAvailableTools(
    executor: ITeamMember,
  ): Promise<LLMToolDefinition[]> {
    const tools: LLMToolDefinition[] = [];

    // 从 ToolRegistry 获取工具
    if (this.toolRegistry) {
      for (const toolId of executor.tools) {
        const tool = this.toolRegistry.tryGet(toolId);
        if (tool) {
          tools.push({
            type: "function",
            function: {
              name: tool.id,
              description: tool.description,
              parameters: tool.inputSchema as unknown as Record<
                string,
                unknown
              >,
            },
          });
        }
      }
    }

    // 从 MCP 获取工具
    if (this.mcpManager) {
      try {
        const mcpTools = await this.mcpManager.getAllToolsFlat();
        for (const { tool } of mcpTools) {
          tools.push({
            type: "function",
            function: {
              name: `mcp_${tool.name}`,
              description: tool.description,
              parameters: tool.inputSchema as unknown as Record<
                string,
                unknown
              >,
            },
          });
        }
      } catch (error) {
        this.logger.warn(
          `Failed to get MCP tools: ${(error as Error).message}`,
        );
      }
    }

    return tools;
  }

  /**
   * 处理工具调用
   */
  private async handleToolCalls(
    toolCalls: Array<{ name: string; arguments: Record<string, unknown> }>,
  ): Promise<unknown[]> {
    const results: unknown[] = [];

    for (const call of toolCalls) {
      try {
        // MCP 工具
        if (call.name.startsWith("mcp_") && this.mcpManager) {
          const toolName = call.name.replace("mcp_", "");
          const result = await this.mcpManager.callToolAuto(
            toolName,
            call.arguments,
          );
          results.push({ tool: call.name, result });
          continue;
        }

        // 内置工具
        if (this.toolRegistry) {
          const tool = this.toolRegistry.tryGet(call.name);
          if (tool) {
            const toolContext = {
              executionId: uuidv4(),
              toolId: call.name,
              callerType: "orchestrator" as const,
              createdAt: new Date(),
            };
            const result = await tool.execute(call.arguments, toolContext);
            results.push({ tool: call.name, result });
            continue;
          }
        }

        results.push({ tool: call.name, error: "Tool not found" });
      } catch (error) {
        results.push({ tool: call.name, error: (error as Error).message });
      }
    }

    return results;
  }

  /**
   * 审核步骤输出
   */
  async review(
    stepId: string,
    output: unknown,
    team: ITeam,
  ): Promise<StepReviewResult> {
    this.logger.log(`Reviewing step ${stepId}...`);

    if (this.llmFactory) {
      const adapter = this.llmFactory.getAdapter();
      if (adapter) {
        try {
          const systemPrompt = `你是一个质量审核专家。请审核以下输出，评估其质量、准确性和完整性。
给出 1-10 的分数，以及详细反馈。

输出 JSON 格式：
{
  "score": number,
  "passed": boolean,
  "feedback": string,
  "issues": []
}
CRITICAL: Your entire response MUST be valid JSON only. No explanation, no markdown, no code blocks. Start with { and end with }.`;

          const response = await adapter.chat({
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: JSON.stringify(output) },
            ],
            model: team.leader.model,
            taskProfile: { creativity: "low", outputLength: "short" },
            responseFormat: "json",
          });

          if (response.usage) {
            this.constraintEngine.recordCost(
              `review_${stepId}`,
              response.model || "unknown",
              response.usage.promptTokens || 0,
              response.usage.completionTokens || 0,
            );
          }

          const reviewContent = response.content || "";
          // Try direct parse first (JSON mode response), then fall back to extraction
          let parsed: ReturnType<typeof JSON.parse> | null = null;
          try {
            parsed = JSON.parse(reviewContent.trim());
          } catch {
            try {
              const extracted = this.extractFirstJsonObject(reviewContent);
              if (extracted) parsed = JSON.parse(extracted);
            } catch {
              // Both parse attempts failed; parsed remains null, falls through to degraded score
            }
          }
          if (parsed) {
            return {
              stepId,
              passed: parsed.passed ?? parsed.score >= 7,
              score: parsed.score,
              feedback: parsed.feedback,
              reviewedAt: new Date(),
            };
          }
        } catch (error) {
          this.logger.warn(`LLM review failed: ${(error as Error).message}`);
        }
      }
    }

    // 降级：LLM 审核不可用，返回固定通过（score 7，不触发返工）
    return {
      stepId,
      passed: true,
      score: 7,
      feedback: "LLM 审核不可用，降级通过",
      reviewedAt: new Date(),
    };
  }

  /**
   * ★ 生成交付物（集成导出工具）
   */
  async deliver(
    state: MissionExecutionState,
    _team: ITeam,
  ): Promise<MissionDeliverable[]> {
    this.logger.log("Generating deliverables...");

    const deliverables: MissionDeliverable[] = [];
    const allOutputs = Array.from(state.intermediateOutputs.values());

    // ★ 尝试使用导出工具生成文档
    const exportTools = ["export-docx", "export-pdf"];
    let documentGenerated = false;

    if (this.toolRegistry) {
      for (const toolId of exportTools) {
        const tool = this.toolRegistry.tryGet(toolId);
        if (tool) {
          try {
            // 整合内容
            const content = this.integrateOutputsForExport(allOutputs);

            const toolContext = {
              executionId: uuidv4(),
              toolId,
              callerType: "orchestrator" as const,
              createdAt: new Date(),
            };
            const result = await tool.execute(
              {
                title: "任务报告",
                content,
                format: toolId.replace("export-", ""),
              },
              toolContext,
            );

            if (result) {
              deliverables.push({
                id: uuidv4(),
                missionId: state.missionId,
                type: toolId.replace("export-", "") as "report",
                name: `任务报告.${toolId.replace("export-", "")}`,
                description: "自动生成的任务报告文档",
                mimeType:
                  toolId === "export-pdf"
                    ? "application/pdf"
                    : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                size: 0,
                content: result,
                createdAt: new Date(),
              });
              documentGenerated = true;
              break;
            }
          } catch (error) {
            this.logger.warn(
              `Export tool ${toolId} failed: ${(error as Error).message}`,
            );
          }
        }
      }
    }

    // 始终生成 JSON 报告
    deliverables.push({
      id: uuidv4(),
      missionId: state.missionId,
      type: "report",
      name: "任务报告",
      description: documentGenerated
        ? "任务执行结果详细数据"
        : "任务执行结果汇总报告",
      mimeType: "application/json",
      size: JSON.stringify(allOutputs).length,
      content: {
        summary: "任务执行完成",
        outputs: allOutputs,
        statistics: {
          totalSteps: state.completedSteps.length + state.failedSteps.length,
          completedSteps: state.completedSteps.length,
          failedSteps: state.failedSteps.length,
          reworkCount: state.resourceUsage.reworkCount,
          reviewResults: state.reviewResults,
        },
      },
      createdAt: new Date(),
    });

    return deliverables;
  }

  /**
   * ★ 整合输出用于导出
   */
  private integrateOutputsForExport(outputs: unknown[]): string {
    const sections: string[] = [];

    for (let i = 0; i < outputs.length; i++) {
      const output = outputs[i];
      if (typeof output === "string") {
        sections.push(output);
      } else if (output && typeof output === "object") {
        const obj = output as Record<string, unknown>;
        if (obj.output) {
          sections.push(String(obj.output));
        } else {
          sections.push(JSON.stringify(output, null, 2));
        }
      }
    }

    return sections.join("\n\n---\n\n");
  }

  /**
   * 取消执行
   */
  async cancel(missionId: string): Promise<void> {
    const state = this.states.get(missionId);
    if (state) {
      state.phase = "failed";
      this.logger.log(`Mission ${missionId} cancelled`);
    }
    const traceId = this.missionTraces.get(missionId);
    if (traceId) {
      this.traceCollector?.endTrace(traceId, {
        status: "error",
      });
      this.missionTraces.delete(missionId);
    }
    this.a2aBus?.clearSession(missionId);
    this.originalInputs.delete(missionId);
    // ★ 停心跳 + 清 runtime store
    this.stopHeartbeat(missionId);
  }

  /**
   * 获取执行状态（同步路径 —— 仅 in-memory；跨 pod 请用 getStateAsync）
   */
  getState(missionId: string): MissionExecutionState | undefined {
    return this.states.get(missionId);
  }

  /**
   * ★ Phase 9 (2026-04-30): 跨 pod 取 state —— in-memory miss 时降级到 runtime store。
   * 用于 admin / recovery 场景，普通 mission 执行循环仍走同步 getState。
   */
  async getStateAsync(
    missionId: string,
  ): Promise<MissionExecutionState | undefined> {
    const local = this.states.get(missionId);
    if (local) return local;
    if (!this.runtimeStore) return undefined;
    const remote = await this.runtimeStore.getState(missionId);
    if (remote) {
      // 回填 in-memory（避免重复读 Redis）
      this.states.set(missionId, remote);
    }
    return remote;
  }

  /**
   * 更新执行状态（供外部流程使用）
   * 用于非标准流程（如 generateFullStory）同步状态到 orchestrator
   */
  updateState(
    missionId: string,
    updates: {
      phase?: OrchestratorPhase;
      currentSteps?: string[];
      completedSteps?: string[];
      progress?: number;
    },
  ): void {
    let state = this.states.get(missionId);
    if (!state) {
      state = this.initializeState(missionId);
      this.states.set(missionId, state);
    }

    if (updates.phase !== undefined) {
      state.phase = updates.phase;
    }
    if (updates.currentSteps !== undefined) {
      state.currentSteps = updates.currentSteps;
    }
    if (updates.completedSteps !== undefined) {
      state.completedSteps = updates.completedSteps;
    }
    if (updates.progress !== undefined) {
      state.resourceUsage.progress = updates.progress;
    }

    this.logger.debug(
      `[${missionId}] State updated: phase=${state.phase}, current=${state.currentSteps.join(",")}, completed=${state.completedSteps.join(",")}`,
    );
  }

  /**
   * 获取资源使用情况
   */
  getResourceUsage(missionId: string): ResourceUsage | undefined {
    return this.states.get(missionId)?.resourceUsage;
  }

  // ==================== Memory é›†æˆ ====================

  private async storeContext(
    missionId: string,
    key: string,
    value: unknown,
  ): Promise<void> {
    if (!this.memoryService) return;
    try {
      await this.memoryService.setWithSession(missionId, key, value);
    } catch (error) {
      this.logger.warn(`Failed to store context: ${(error as Error).message}`);
    }
  }

  private async getContext(
    missionId: string,
  ): Promise<Record<string, unknown>> {
    if (!this.memoryService) return {};
    try {
      const input = await this.memoryService.getWithSession(missionId, "input");
      const intent = await this.memoryService.getWithSession(
        missionId,
        "intent",
      );
      const plan = await this.memoryService.getWithSession(missionId, "plan");
      return { input, intent, plan };
    } catch {
      return {};
    }
  }

  // ==================== 私有方法 ====================

  private initializeState(missionId: string): MissionExecutionState {
    return {
      missionId,
      phase: "idle",
      resourceUsage: {
        tokensUsed: 0,
        costUsed: 0,
        timeElapsed: 0,
        reviewCount: 0,
        reworkCount: 0,
        progress: 0,
      },
      completedSteps: [],
      currentSteps: [],
      failedSteps: [],
      reviewResults: [],
      intermediateOutputs: new Map(),
      deliverables: [],
    };
  }

  private createEvent(
    type: MissionEventType,
    missionId: string,
    data?: Record<string, unknown>,
  ): MissionEvent {
    return {
      type,
      missionId,
      timestamp: new Date(),
      data,
    };
  }

  private createResult(
    state: MissionExecutionState,
    startTime: number,
    success: boolean,
    errorMessage?: string,
  ): MissionResult {
    const duration = Date.now() - startTime;

    return {
      missionId: state.missionId,
      success,
      deliverables: state.deliverables,
      summary: success ? "任务执行成功" : `任务执行失败: ${errorMessage}`,
      tokensUsed: state.resourceUsage.tokensUsed,
      costUsed: state.resourceUsage.costUsed,
      duration,
      error: errorMessage
        ? {
            code: "EXECUTION_ERROR",
            message: errorMessage,
            retryable: true,
          }
        : undefined,
      statistics: {
        totalSteps: state.completedSteps.length + state.failedSteps.length,
        completedSteps: state.completedSteps.length,
        failedSteps: state.failedSteps.length,
        skippedSteps: 0,
        reworkCount: state.resourceUsage.reworkCount,
        membersInvolved: 0,
        toolCalls: 0,
        skillCalls: 0,
        reviewCount: state.reviewResults.length,
        reviewPassRate:
          state.reviewResults.length > 0
            ? state.reviewResults.filter((r) => r.passed).length /
              state.reviewResults.length
            : 1,
      },
    };
  }

  private updateResourceUsage(
    state: MissionExecutionState,
    startTime: number,
  ): ResourceUsage {
    const totalSteps =
      state.completedSteps.length +
      state.failedSteps.length +
      state.currentSteps.length;
    const progress =
      totalSteps > 0 ? state.completedSteps.length / totalSteps : 0;

    return {
      ...state.resourceUsage,
      timeElapsed: Date.now() - startTime,
      progress,
    };
  }

  private inferTaskType(prompt: string): TaskType {
    const keywords: Record<TaskType, string[]> = {
      research: ["研究", "调研", "分析", "报告"],
      analysis: ["分析", "评估", "对比", "趋势"],
      creation: ["写", "创作", "生成", "撰写"],
      design: ["设计", "UI", "界面", "视觉"],
      debate: ["辩论", "讨论", "对抗", "观点"],
      review: ["审核", "检查", "验证", "评审"],
      mixed: [],
    };

    for (const [type, words] of Object.entries(keywords)) {
      if (words.some((word) => prompt.includes(word))) {
        return type as TaskType;
      }
    }

    return "mixed";
  }

  private assessComplexity(input: MissionInput): ParsedIntent["complexity"] {
    const promptLength = input.prompt.length;
    const hasFiles = (input.files?.length || 0) > 0;
    const hasUrls = (input.urls?.length || 0) > 0;
    const hasRequirements = (input.requirements?.length || 0) > 0;

    let score = 0;
    if (promptLength > 500) score += 2;
    else if (promptLength > 200) score += 1;
    if (hasFiles) score += 1;
    if (hasUrls) score += 1;
    if (hasRequirements) score += 1;

    const overall: ComplexityLevel =
      score >= 4
        ? "very_high"
        : score >= 3
          ? "high"
          : score >= 2
            ? "medium"
            : "low";

    return {
      overall,
      informational: overall,
      logical: overall,
      creative: overall,
      estimatedSubTasks: Math.max(3, score + 2),
      estimatedDuration: (score + 1) * 60000,
      estimatedCost: (score + 1) * 50,
    };
  }

  private extractTopics(prompt: string): string[] {
    const words = prompt.split(/[，。！？、\s]+/).filter((w) => w.length > 2);
    return words.slice(0, 5);
  }

  private mapStepType(workflowType: string): ExecutionStep["type"] {
    if (workflowType === "review") return "review";
    if (workflowType === "decision") return "task";
    return "task";
  }

  private estimateStepDuration(_stepType: string, depth: string): number {
    const base = 30000;
    const multiplier =
      depth === "comprehensive" ? 3 : depth === "standard" ? 2 : 1;
    return base * multiplier;
  }

  private estimateStepCost(duration: number, modelPreference: string): number {
    const base = duration / 10000;
    const multiplier =
      modelPreference === "premium"
        ? 3
        : modelPreference === "balanced"
          ? 2
          : 1;
    return Math.ceil(base * multiplier);
  }

  private calculateTotalDuration(steps: ExecutionStep[]): number {
    return steps.reduce((sum, s) => sum + s.estimatedDuration, 0);
  }

  /**
   * ★ 保存检查点（非阻塞，失败时记录警告）
   */
  private async saveCheckpoint(
    executionId: string,
    workflowId: string,
    phase: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    if (!this.checkpointManager) return;

    try {
      const state = this.states.get(executionId);
      const stepResults = new Map<string, StepResult>();
      if (state?.intermediateOutputs) {
        for (const [key, value] of state.intermediateOutputs.entries()) {
          stepResults.set(key, {
            stepId: key,
            status: "completed" as const,
            output: value,
            startTime: new Date(),
          });
        }
      }

      const context: ExecutionContext = {
        executionId,
        workflowId,
        input: JSON.parse(JSON.stringify(data)),
        state: {},
        stepResults,
        startTime: new Date(),
      };

      await this.checkpointManager.createCheckpoint(
        executionId,
        workflowId,
        phase,
        context,
      );
      this.logger.debug(`[${executionId}] Checkpoint saved: ${phase}`);
    } catch (error) {
      this.logger.warn(
        `[${executionId}] Failed to save checkpoint at ${phase}: ${(error as Error).message}`,
      );
    }
  }

  // â”€â”€â”€ AI Kernel Helpers â”€â”€â”€

  /**
   * ★ 记录 Kernel 事件（fire-and-forget，不阻塞主流程）
   */
  private recordKernelEvent(
    missionId: string,
    type: string,
    payload?: Record<string, unknown>,
  ): void {
    const processId = this.kernelProcessIds.get(missionId);
    if (!processId || !this.kernelJournal) return;

    this.kernelJournal
      .record(processId, type, payload)
      .catch((err) =>
        this.logger.warn(
          `[Kernel] Failed to record event ${type}: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
  }

  /**
   * ★ 标记 Kernel 进程完成（fire-and-forget）
   */
  private completeKernelProcess(
    missionId: string,
    output?: Record<string, unknown>,
  ): void {
    const processId = this.kernelProcessIds.get(missionId);
    if (!processId || !this.missionExecutor) return;

    this.missionExecutor
      .complete(processId, output)
      .catch((err) =>
        this.logger.warn(
          `[Kernel] Failed to complete process: ${err instanceof Error ? err.message : String(err)}`,
        ),
      )
      .finally(() => this.kernelProcessIds.delete(missionId));
  }

  /**
   * ★ 标记 Kernel 进程失败（fire-and-forget）
   */
  private failKernelProcess(missionId: string, error: string): void {
    const processId = this.kernelProcessIds.get(missionId);
    if (!processId || !this.missionExecutor) return;

    this.missionExecutor
      .fail(processId, error)
      .catch((err) =>
        this.logger.warn(
          `[Kernel] Failed to mark process as failed: ${err instanceof Error ? err.message : String(err)}`,
        ),
      )
      .finally(() => this.kernelProcessIds.delete(missionId));
  }
}
