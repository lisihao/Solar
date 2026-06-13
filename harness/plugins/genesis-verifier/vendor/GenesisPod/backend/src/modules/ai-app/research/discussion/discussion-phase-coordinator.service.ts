import { Injectable, Logger, Optional } from "@nestjs/common";
import { Subject } from "rxjs";
import { AIModelType, DeepResearchStatus } from "@prisma/client";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import { DiscussionAgentService } from "./discussion-agent.service";
import { IterativeSearchService } from "./iterative-search.service";
import { ReportSynthesizerService } from "./report-synthesizer.service";
import {
  CreditsService,
  InsufficientCreditsException,
} from "../../../platform/facade";
import { ResearchIdeaService } from "../idea/research-idea.service";
import { AgentFacade, TeamFacade } from "@/modules/ai-harness/facade";
import {
  MissionExecutorService,
  MissionContext,
} from "@/modules/ai-harness/facade";
import { ResearchReplannerService } from "./research-replanner.service";
import { ResearchToolRouterService } from "../search/research-tool-router.service";
import type { ResearchToolStrategy } from "../search/research-tool-router.types";
import { ResearchQualityGateService } from "../quality/research-quality-gate.service";
import { ResearchFactCheckerService } from "../quality/research-fact-checker.service";
import { LruMap } from "@/common/utils/lru-map";
import {
  StartDeepResearchDto,
  DeepResearchSSEEvent,
  DeepResearchReport,
  SearchRound,
  ResearchPlanStep,
  PlanApprovalRequest,
} from "./types";
import {
  DiscussionMessage,
  AgentState,
  ResearchDirection,
} from "./discussion-types";
import {
  ResearchLanguage,
  resolveLanguage,
  PHASE_MESSAGES,
  ORCHESTRATOR_PROMPTS,
  SEARCH_MESSAGES,
} from "./prompt-locale";
import { ORCHESTRATOR_CONFIG, CREDITS_CONFIG } from "../config/research.config";
import { DiscussionSessionService } from "./discussion-session.service";
import { DiscussionStreamService } from "./discussion-stream.service";

/**
 * 讨论阶段协调器
 *
 * 职责: FSM 状态机驱动，编排 Ideation → Execution → Findings → Synthesis 四个阶段，
 * 并管理 AI Kernel 进程生命周期、积分检查和长期记忆写入。
 */
@Injectable()
export class DiscussionPhaseCoordinatorService {
  private readonly logger = new Logger(DiscussionPhaseCoordinatorService.name);
  private readonly STAGE_TIMEOUT = ORCHESTRATOR_CONFIG.STAGE_TIMEOUT_MS;
  /** Synthesis involves multi-step report generation; needs a longer timeout */
  private readonly SYNTHESIS_TIMEOUT = ORCHESTRATOR_CONFIG.SYNTHESIS_TIMEOUT_MS;
  private readonly kernelProcessIds = new LruMap<string, string>(500);
  /** Per-project flag to request skipping the current phase */
  private readonly skipFlags = new Map<string, boolean>();

  /**
   * Request skip of the current phase for a project.
   * The phase runner checks this flag at natural boundaries.
   */
  requestSkipPhase(projectId: string): boolean {
    this.skipFlags.set(projectId, true);
    this.logger.log(`[Skip] Skip requested for project ${projectId}`);
    return true;
  }

  /** Check and clear skip flag — called by phase runners between LLM calls */
  consumeSkipFlag(projectId: string): boolean {
    const skip = this.skipFlags.get(projectId) ?? false;
    if (skip) {
      this.skipFlags.delete(projectId);
      this.logger.log(`[Skip] Consuming skip flag for project ${projectId}`);
    }
    return skip;
  }

  constructor(
    private readonly prisma: PrismaService,
    private readonly agentService: DiscussionAgentService,
    private readonly searchService: IterativeSearchService,
    private readonly reportService: ReportSynthesizerService,
    private readonly sessionService: DiscussionSessionService,
    private readonly streamService: DiscussionStreamService,
    @Optional() private readonly creditsService: CreditsService,
    @Optional() private readonly ideaService: ResearchIdeaService,
    @Optional() private readonly agentFacade: AgentFacade,
    @Optional() private readonly teamFacade: TeamFacade,
    @Optional() private readonly replanner: ResearchReplannerService,
    @Optional() private readonly missionExecutor?: MissionExecutorService,
    @Optional() private readonly toolRouter?: ResearchToolRouterService,
    @Optional() private readonly qualityGate?: ResearchQualityGateService,
    @Optional() private readonly factChecker?: ResearchFactCheckerService,
  ) {}

  /**
   * 仅生成研究计划，不执行研究流程
   * 创建 PLAN_READY 状态的 session，返回计划供用户审批
   */
  async generatePlanOnly(
    projectId: string,
    dto: StartDeepResearchDto,
  ): Promise<PlanApprovalRequest> {
    const language = resolveLanguage(dto.options?.language);
    const depth = dto.options?.depth || "standard";

    const project = await this.prisma.researchProject.findUnique({
      where: { id: projectId },
      select: { userId: true },
    });

    if (!project) {
      throw new Error("Project not found");
    }

    // 积分检查
    const estimatedCredits =
      CREDITS_CONFIG.PER_DEPTH[
        depth as keyof typeof CREDITS_CONFIG.PER_DEPTH
      ] ?? CREDITS_CONFIG.DEFAULT;

    if (this.creditsService) {
      const balanceCheck = await this.creditsService.checkBalance(
        project.userId,
        estimatedCredits,
      );
      if (!balanceCheck.sufficient) {
        throw new InsufficientCreditsException(
          estimatedCredits,
          balanceCheck.balance,
        );
      }
    }

    // 初始化 Agent 团队并生成研究方向
    const team = this.agentService.initializeTeam(dto.query, language);
    const allMessages: DiscussionMessage[] = [];
    const silentSubject = new Subject<DeepResearchSSEEvent>();
    silentSubject.subscribe(); // drain without emitting to any client

    const directions = await this.runIdeationPhase(
      "plan-only",
      dto,
      team,
      allMessages,
      silentSubject,
      language,
    );

    silentSubject.complete();

    // 将 directions 转换为 ResearchPlan
    const roundsPerDirection: Record<string, number> = {
      quick: 1,
      standard: 2,
      thorough: 3,
    };
    const rounds = roundsPerDirection[depth] || 2;

    const steps: ResearchPlanStep[] = [];
    for (const [dirIdx, dir] of directions.entries()) {
      for (let r = 0; r < rounds && r < dir.searchQueries.length; r++) {
        steps.push({
          id: `step_${dirIdx}_${r}`,
          type: r === 0 ? "initial_search" : "deep_dive",
          query: dir.searchQueries[r] || dir.title,
          rationale: dir.description,
          estimatedSources: 10,
        });
      }
    }

    const estimatedTimePerStep: Record<string, number> = {
      quick: 30,
      standard: 60,
      thorough: 90,
    };
    const timePerStep = estimatedTimePerStep[depth] || 60;
    const estimatedTime = steps.length * timePerStep;

    const plan = {
      objective: dto.query,
      approach: directions.map((d) => d.title).join(" / "),
      steps,
      estimatedTime,
    };

    // 创建 PLAN_READY 状态的 session，保存计划
    const session = await this.prisma.deepResearchSession.create({
      data: {
        projectId,
        query: dto.query,
        mode: dto.mode ?? "single",
        status: DeepResearchStatus.PLAN_READY,
        plan: plan as object,
        directions: { directions } as object,
      },
    });

    this.logger.log(
      `[generatePlanOnly] Created PLAN_READY session ${session.id} with ${steps.length} steps`,
    );

    return {
      sessionId: session.id,
      plan,
      estimatedTime,
      depth,
    };
  }

  /**
   * 执行完整的讨论驱动研究流程
   */
  async executeDiscussion(
    projectId: string,
    dto: StartDeepResearchDto,
    subject: Subject<DeepResearchSSEEvent>,
  ): Promise<void> {
    const startTime = Date.now();
    const language = resolveLanguage(dto.options?.language);
    const allMessages: DiscussionMessage[] = [];
    const searchRounds: SearchRound[] = [];

    // ★ 工具路由：根据查询主题分类，选择最佳搜索工具组合
    const toolStrategy: ResearchToolStrategy | undefined =
      this.toolRouter?.buildToolStrategy(dto.query);

    // Start observability trace
    const traceId = this.agentFacade?.startTrace({
      name: `Research: ${dto.query.slice(0, 80)}`,
      type: "research",
      metadata: { projectId, depth: dto.options?.depth || "standard" },
    });

    // 获取项目 userId 用于积分检查
    const project = await this.prisma.researchProject.findUnique({
      where: { id: projectId },
      select: { userId: true },
    });

    if (!project) {
      throw new Error("Project not found");
    }

    // 积分检查
    const depth = dto.options?.depth || "standard";
    const estimatedCredits =
      CREDITS_CONFIG.PER_DEPTH[
        depth as keyof typeof CREDITS_CONFIG.PER_DEPTH
      ] ?? CREDITS_CONFIG.DEFAULT;

    if (this.creditsService) {
      const balanceCheck = await this.creditsService.checkBalance(
        project.userId,
        estimatedCredits,
      );
      if (!balanceCheck.sufficient) {
        throw new InsufficientCreditsException(
          estimatedCredits,
          balanceCheck.balance,
        );
      }
    }

    // 创建会话
    const session = await this.prisma.deepResearchSession.create({
      data: {
        projectId,
        query: dto.query,
        mode: dto.mode ?? "single",
        status: DeepResearchStatus.IDEATION,
      },
    });

    // Spawn AI Kernel process for tracking
    if (this.missionExecutor) {
      try {
        const kernelResult = await this.missionExecutor.execute({
          userId: project.userId,
          agentId: "research-discussion",
          teamSessionId: session.id,
          input: {
            query: dto.query.slice(0, 200),
            depth: dto.options?.depth || "standard",
          },
        });
        this.kernelProcessIds.set(session.id, kernelResult.processId);
      } catch (err) {
        this.logger.warn(
          `[Kernel] Failed to spawn process: ${(err as Error).message}`,
        );
      }
    }

    const sessionProcessId = this.kernelProcessIds.get(session.id);
    const runPhases = async () => {
      try {
        // 初始化 Agent 团队
        const team = this.agentService.initializeTeam(dto.query, language);

        // ========== Phase 1: IDEATION ==========
        subject.next({
          type: "discussion.phase",
          data: {
            phase: "ideation",
            summary: PHASE_MESSAGES[language].ideation,
          },
        });

        const ideationSpanId = traceId
          ? this.agentFacade?.addSpan(traceId, {
              name: "ideation",
              type: "phase",
            })
          : undefined;

        const directions = await this.runIdeationPhase(
          session.id,
          dto,
          team,
          allMessages,
          subject,
          language,
        );

        if (ideationSpanId) {
          this.agentFacade?.endSpan(ideationSpanId, {
            status: "success",
            output: { directionsCount: directions.length },
          });
        }

        await this.sessionService.updateSession(session.id, {
          status: DeepResearchStatus.SEARCHING,
          directions: { directions } as unknown as Record<string, unknown>,
          discussion: allMessages as unknown as Record<string, unknown>[],
        });

        // ========== Phase 2: EXECUTION ==========
        subject.next({
          type: "discussion.phase",
          data: {
            phase: "execution",
            summary: PHASE_MESSAGES[language].execution,
            directions: directions.map((d) => d.title),
          },
        });

        const executionSpanId = traceId
          ? this.agentFacade?.addSpan(traceId, {
              name: "execution",
              type: "phase",
            })
          : undefined;

        await this.runExecutionPhase(
          session.id,
          dto,
          team,
          directions,
          searchRounds,
          allMessages,
          subject,
          language,
          toolStrategy,
        );

        // ========== Dynamic Replanning ==========
        if (this.replanner && searchRounds.length > 0) {
          const replanSpanId = traceId
            ? this.agentFacade?.addSpan(traceId, {
                name: "replanning",
                type: "evaluation",
              })
            : undefined;

          const replanResult = await this.replanner.evaluateAndReplan(
            dto.query,
            searchRounds,
            dto.options?.language,
          );

          if (
            replanResult.needsReplan &&
            replanResult.additionalSteps.length > 0
          ) {
            this.logger.log(
              `[Replanner] Adding ${replanResult.additionalSteps.length} extra searches: ${replanResult.record?.reason}`,
            );

            const replanTotal =
              searchRounds.length + replanResult.additionalSteps.length;

            for (const step of replanResult.additionalSteps) {
              const roundNum = searchRounds.length + 1;
              subject.next({
                type: "search_progress",
                data: {
                  round: roundNum,
                  totalRounds: replanTotal,
                  query: step.query,
                  resultsCount: 0,
                  message:
                    language === "en-US"
                      ? `[Gap Fill] Searching: ${step.query}`
                      : `[补充搜索] 查询: ${step.query}`,
                },
              });

              // ★ Replan 补充搜索也使用工具路由
              const replanResolution =
                toolStrategy && this.toolRouter
                  ? this.toolRouter.resolveToolsForStep(
                      step,
                      toolStrategy.topicType,
                      toolStrategy.stepOverrides,
                    )
                  : undefined;

              const round = await this.streamService
                .withTimeout(
                  this.searchService.executeStep(
                    step,
                    roundNum,
                    replanResolution,
                  ),
                  this.STAGE_TIMEOUT,
                  `Replan search ${roundNum}`,
                )
                .catch((err: unknown) => {
                  this.logger.warn(
                    `[Replanner] Extra search failed: ${err instanceof Error ? err.message : String(err)}`,
                  );
                  return null;
                });

              if (round) {
                searchRounds.push(round);
                subject.next({
                  type: "search_progress",
                  data: {
                    round: roundNum,
                    totalRounds: replanTotal,
                    query: step.query,
                    resultsCount: round.resultsCount,
                    message:
                      language === "en-US"
                        ? `[Gap Fill] Found ${round.resultsCount} additional sources`
                        : `[补充搜索] 找到 ${round.resultsCount} 个来源`,
                  },
                });
              }
            }
          }

          if (replanSpanId) {
            this.agentFacade?.endSpan(replanSpanId, {
              status: "success",
              output: {
                replanned: replanResult.needsReplan,
                addedSteps: replanResult.additionalSteps.length,
              },
            });
          }
        }

        if (executionSpanId) {
          this.agentFacade?.endSpan(executionSpanId, {
            status: "success",
            output: { searchRounds: searchRounds.length },
          });
        }

        await this.sessionService.updateSession(session.id, {
          searchRounds: searchRounds as unknown as Record<string, unknown>[],
          discussion: allMessages as unknown as Record<string, unknown>[],
        });

        // ========== Phase 3: FINDINGS ==========
        subject.next({
          type: "discussion.phase",
          data: {
            phase: "findings",
            summary: PHASE_MESSAGES[language].findings,
          },
        });

        await this.sessionService.updateSession(session.id, {
          status: DeepResearchStatus.FINDINGS as DeepResearchStatus,
        });

        const findingsSpanId = traceId
          ? this.agentFacade?.addSpan(traceId, {
              name: "findings",
              type: "phase",
            })
          : undefined;

        await this.runFindingsPhase(
          session.id,
          dto,
          team,
          searchRounds,
          allMessages,
          subject,
          language,
        );

        if (findingsSpanId) {
          this.agentFacade?.endSpan(findingsSpanId, { status: "success" });
        }

        await this.sessionService.updateSession(session.id, {
          discussion: allMessages as unknown as Record<string, unknown>[],
        });

        // ========== Phase 4: SYNTHESIS ==========
        subject.next({
          type: "discussion.phase",
          data: {
            phase: "synthesis",
            summary: PHASE_MESSAGES[language].synthesis,
          },
        });

        await this.sessionService.updateSession(session.id, {
          status: DeepResearchStatus.SYNTHESIZING,
        });

        const synthesisSpanId = traceId
          ? this.agentFacade?.addSpan(traceId, {
              name: "synthesis",
              type: "phase",
            })
          : undefined;

        const report = await this.runSynthesisPhase(
          session.id,
          dto,
          team,
          searchRounds,
          allMessages,
          subject,
          language,
        );

        if (synthesisSpanId) {
          this.agentFacade?.endSpan(synthesisSpanId, {
            status: "success",
            output: {
              sections: report.sections.length,
              references: report.references.length,
            },
          });
        }

        // ========== 完成 ==========
        const totalSources =
          this.streamService.countUniqueSources(searchRounds);
        const duration = (Date.now() - startTime) / 1000;

        const finalReport: DeepResearchReport = {
          ...report,
          metadata: {
            ...report.metadata,
            totalSources,
            duration,
            searchRounds: searchRounds.length,
          },
        };

        await this.sessionService.updateSession(session.id, {
          status: DeepResearchStatus.COMPLETED,
          report: finalReport as unknown as Record<string, unknown>,
          discussion: allMessages as unknown as Record<string, unknown>[],
          sourcesUsed: totalSources,
          completedAt: new Date(),
        });

        subject.next({
          type: "interaction.complete",
          data: {
            sessionId: session.id,
            report: finalReport,
            status: "success",
          },
        });

        this.logger.log(
          `Discussion research completed: ${session.id}, sources: ${totalSources}, duration: ${duration.toFixed(1)}s`,
        );

        // Complete AI Kernel process
        this.completeKernelProcess(session.id, {
          totalSources,
          duration,
          searchRounds: searchRounds.length,
        });

        // End observability trace
        if (traceId) {
          this.agentFacade?.endTrace(traceId, {
            status: "success",
            totalDuration: Date.now() - startTime,
          });
        }

        // 反哺长期记忆（fire-and-forget，不阻塞主流程）
        this.agentFacade
          ?.coordinatorStore(
            {
              type: "knowledge",
              key: `research:${session.id}`,
              value: {
                title: dto.query.slice(0, 100),
                summary: (finalReport.executiveSummary || dto.query).slice(
                  0,
                  2000,
                ),
                url: `/ai-research/${projectId}`,
                completedAt: new Date().toISOString(),
                sources: totalSources,
              },
              importance: 0.8,
              tags: ["research", "completed"],
            },
            project.userId,
          )
          ?.catch((err: unknown) => {
            this.logger.warn(
              `[memory] Failed to store research memory for session ${session.id}: ${err instanceof Error ? err.message : String(err)}`,
            );
          });

        // Auto-extract ideas from discussion messages
        // Skip in iterative mode — the iteration service handles extraction and
        // calling it here would cause a duplicate (and the 2nd run deletes+recreates).
        if (
          session.mode !== "iterative" &&
          session.mode !== "iterative_internal"
        ) {
          try {
            await this.autoExtractIdeas(projectId, session.id, allMessages);
          } catch (extractError) {
            this.logger.warn(
              `Failed to auto-extract ideas from session ${session.id}: ${extractError instanceof Error ? extractError.message : String(extractError)}`,
            );
          }
        }
      } catch (error) {
        // Fail AI Kernel process
        this.failKernelProcess(
          session.id,
          error instanceof Error ? error.message : String(error),
        );

        // End trace on failure
        if (traceId) {
          this.agentFacade?.endTrace(traceId, {
            status: "error",
            totalDuration: Date.now() - startTime,
          });
        }
        await this.sessionService.updateSession(session.id, {
          status: DeepResearchStatus.FAILED,
          error: error instanceof Error ? error.message : String(error),
          discussion: allMessages as unknown as Record<string, unknown>[],
        });
        throw error;
      } finally {
        subject.complete();
        this.teamFacade?.a2aClearSession(session.id);
      }
    };

    await (sessionProcessId
      ? MissionContext.run(
          { agentProcessId: sessionProcessId, userId: project.userId },
          runPhases,
        )
      : runPhases());
  }

  /**
   * 从审批通过的计划继续执行研究流程
   * 跳过 Ideation 阶段，直接使用已保存的方向开始 Execution
   */
  async executeApprovedPlan(
    sessionId: string,
    subject: Subject<DeepResearchSSEEvent>,
  ): Promise<void> {
    const startTime = Date.now();

    const session = await this.prisma.deepResearchSession.findUnique({
      where: { id: sessionId },
      include: { project: { select: { userId: true } } },
    });

    if (!session) {
      throw new Error("Session not found");
    }

    if (session.status !== DeepResearchStatus.PLAN_READY) {
      throw new Error(
        `Session ${sessionId} is not in PLAN_READY state (current: ${session.status})`,
      );
    }

    const projectId = session.projectId;
    const userId = session.project.userId;

    const dto: StartDeepResearchDto = {
      query: session.query,
      mode: (session.mode as StartDeepResearchDto["mode"]) ?? "single",
    };

    const language = resolveLanguage(undefined);
    const depth = "standard";
    const allMessages: DiscussionMessage[] = [];
    const searchRounds: SearchRound[] = [];

    const toolStrategy = this.toolRouter?.buildToolStrategy(session.query);

    const traceId = this.agentFacade?.startTrace({
      name: `Research (approved): ${session.query.slice(0, 80)}`,
      type: "research",
      metadata: { projectId, sessionId, source: "plan-approval" },
    });

    // Spawn AI Kernel process for tracking
    if (this.missionExecutor) {
      try {
        const kernelResult = await this.missionExecutor.execute({
          userId,
          agentId: "research-discussion",
          teamSessionId: sessionId,
          input: { query: session.query.slice(0, 200), depth },
        });
        this.kernelProcessIds.set(sessionId, kernelResult.processId);
      } catch (err) {
        this.logger.warn(
          `[Kernel] Failed to spawn process: ${(err as Error).message}`,
        );
      }
    }

    const sessionProcessId = this.kernelProcessIds.get(sessionId);

    // 从已保存的 directions 恢复研究方向
    const savedDirections = session.directions as unknown as {
      directions: ResearchDirection[];
    } | null;

    const runPhases = async () => {
      try {
        const team = this.agentService.initializeTeam(session.query, language);

        // Restored directions from plan-only phase
        let directions: ResearchDirection[] = [];
        if (
          savedDirections?.directions &&
          savedDirections.directions.length > 0
        ) {
          directions = savedDirections.directions;
          subject.next({
            type: "discussion.phase",
            data: {
              phase: "execution",
              summary: PHASE_MESSAGES[language].execution,
              directions: directions.map((d) => d.title),
            },
          });
        } else {
          // Fallback: run full ideation if directions were not saved
          subject.next({
            type: "discussion.phase",
            data: {
              phase: "ideation",
              summary: PHASE_MESSAGES[language].ideation,
            },
          });

          directions = await this.runIdeationPhase(
            sessionId,
            dto,
            team,
            allMessages,
            subject,
            language,
          );

          subject.next({
            type: "discussion.phase",
            data: {
              phase: "execution",
              summary: PHASE_MESSAGES[language].execution,
              directions: directions.map((d) => d.title),
            },
          });
        }

        await this.sessionService.updateSession(sessionId, {
          status: DeepResearchStatus.SEARCHING,
          directions: { directions } as unknown as Record<string, unknown>,
          discussion: allMessages as unknown as Record<string, unknown>[],
        });

        // ========== Phase 2: EXECUTION ==========
        const executionSpanId = traceId
          ? this.agentFacade?.addSpan(traceId, {
              name: "execution",
              type: "phase",
            })
          : undefined;

        await this.runExecutionPhase(
          sessionId,
          dto,
          team,
          directions,
          searchRounds,
          allMessages,
          subject,
          language,
          toolStrategy,
        );

        // Dynamic Replanning
        if (this.replanner && searchRounds.length > 0) {
          const replanResult = await this.replanner.evaluateAndReplan(
            session.query,
            searchRounds,
            undefined,
          );

          if (
            replanResult.needsReplan &&
            replanResult.additionalSteps.length > 0
          ) {
            this.logger.log(
              `[Replanner] Adding ${replanResult.additionalSteps.length} extra searches`,
            );
            for (const step of replanResult.additionalSteps) {
              const roundNum = searchRounds.length + 1;
              const replanResolution =
                toolStrategy && this.toolRouter
                  ? this.toolRouter.resolveToolsForStep(
                      step,
                      toolStrategy.topicType,
                      toolStrategy.stepOverrides,
                    )
                  : undefined;

              const round = await this.streamService
                .withTimeout(
                  this.searchService.executeStep(
                    step,
                    roundNum,
                    replanResolution,
                  ),
                  this.STAGE_TIMEOUT,
                  `Replan search ${roundNum}`,
                )
                .catch((err: unknown) => {
                  this.logger.warn(
                    `[Replanner] Extra search failed: ${err instanceof Error ? err.message : String(err)}`,
                  );
                  return null;
                });

              if (round) searchRounds.push(round);
            }
          }
        }

        if (executionSpanId) {
          this.agentFacade?.endSpan(executionSpanId, {
            status: "success",
            output: { searchRounds: searchRounds.length },
          });
        }

        await this.sessionService.updateSession(sessionId, {
          searchRounds: searchRounds as unknown as Record<string, unknown>[],
          discussion: allMessages as unknown as Record<string, unknown>[],
        });

        // ========== Phase 3: FINDINGS ==========
        subject.next({
          type: "discussion.phase",
          data: {
            phase: "findings",
            summary: PHASE_MESSAGES[language].findings,
          },
        });

        await this.sessionService.updateSession(sessionId, {
          status: DeepResearchStatus.FINDINGS,
        });

        await this.runFindingsPhase(
          sessionId,
          dto,
          team,
          searchRounds,
          allMessages,
          subject,
          language,
        );

        await this.sessionService.updateSession(sessionId, {
          discussion: allMessages as unknown as Record<string, unknown>[],
        });

        // ========== Phase 4: SYNTHESIS ==========
        subject.next({
          type: "discussion.phase",
          data: {
            phase: "synthesis",
            summary: PHASE_MESSAGES[language].synthesis,
          },
        });

        await this.sessionService.updateSession(sessionId, {
          status: DeepResearchStatus.SYNTHESIZING,
        });

        const report = await this.runSynthesisPhase(
          sessionId,
          dto,
          team,
          searchRounds,
          allMessages,
          subject,
          language,
        );

        const totalSources =
          this.streamService.countUniqueSources(searchRounds);
        const duration = (Date.now() - startTime) / 1000;

        const finalReport: DeepResearchReport = {
          ...report,
          metadata: {
            ...report.metadata,
            totalSources,
            duration,
            searchRounds: searchRounds.length,
          },
        };

        await this.sessionService.updateSession(sessionId, {
          status: DeepResearchStatus.COMPLETED,
          report: finalReport as unknown as Record<string, unknown>,
          discussion: allMessages as unknown as Record<string, unknown>[],
          sourcesUsed: totalSources,
          completedAt: new Date(),
        });

        subject.next({
          type: "interaction.complete",
          data: { sessionId, report: finalReport, status: "success" },
        });

        this.logger.log(
          `[executeApprovedPlan] Completed session ${sessionId}, sources: ${totalSources}, duration: ${duration.toFixed(1)}s`,
        );

        this.completeKernelProcess(sessionId, { totalSources, duration });

        if (traceId) {
          this.agentFacade?.endTrace(traceId, {
            status: "success",
            totalDuration: Date.now() - startTime,
          });
        }

        // Fire-and-forget: 反哺长期记忆
        this.agentFacade
          ?.coordinatorStore(
            {
              type: "knowledge",
              key: `research:${sessionId}`,
              value: {
                title: session.query.slice(0, 100),
                summary: (finalReport.executiveSummary || session.query).slice(
                  0,
                  2000,
                ),
                url: `/ai-research/${projectId}`,
                completedAt: new Date().toISOString(),
                sources: totalSources,
              },
              importance: 0.8,
              tags: ["research", "completed", "plan-approved"],
            },
            userId,
          )
          ?.catch((err: unknown) => {
            this.logger.warn(
              `[memory] Failed to store research memory for session ${sessionId}: ${err instanceof Error ? err.message : String(err)}`,
            );
          });

        if (
          session.mode !== "iterative" &&
          session.mode !== "iterative_internal"
        ) {
          try {
            await this.autoExtractIdeas(projectId, sessionId, allMessages);
          } catch (extractError) {
            this.logger.warn(
              `Failed to auto-extract ideas from session ${sessionId}: ${extractError instanceof Error ? extractError.message : String(extractError)}`,
            );
          }
        }
      } catch (error) {
        this.failKernelProcess(
          sessionId,
          error instanceof Error ? error.message : String(error),
        );

        if (traceId) {
          this.agentFacade?.endTrace(traceId, {
            status: "error",
            totalDuration: Date.now() - startTime,
          });
        }

        await this.sessionService.updateSession(sessionId, {
          status: DeepResearchStatus.FAILED,
          error: error instanceof Error ? error.message : String(error),
          discussion: allMessages as unknown as Record<string, unknown>[],
        });
        throw error;
      } finally {
        subject.complete();
        this.teamFacade?.a2aClearSession(sessionId);
      }
    };

    await (sessionProcessId
      ? MissionContext.run(
          { agentProcessId: sessionProcessId, userId },
          runPhases,
        )
      : runPhases());
  }

  // ==================== Phase 1: Ideation ====================

  private async runIdeationPhase(
    sessionId: string,
    dto: StartDeepResearchDto,
    team: Map<string, AgentState>,
    allMessages: DiscussionMessage[],
    subject: Subject<DeepResearchSSEEvent>,
    language: ResearchLanguage,
  ): Promise<ResearchDirection[]> {
    const isFollowUp = dto.isFollowUp ?? false;
    const director = this.streamService.getAgent(team, "director");
    const researcherA = this.streamService.getAgent(team, "researcher-a");
    const researcherB = this.streamService.getAgent(team, "researcher-b");
    const researcherC = this.streamService.getAgent(team, "researcher-c");
    const analyst = this.streamService.getAgent(team, "analyst");

    const op = ORCHESTRATOR_PROMPTS[language];

    // Build a concise summary of previous findings for follow-up rounds
    let previousFindings: string | undefined;
    if (isFollowUp && dto.previousContext) {
      const ctx = dto.previousContext;
      const parts: string[] = [];
      if (ctx.executiveSummary) {
        parts.push(`**核心摘要**: ${ctx.executiveSummary.slice(0, 500)}`);
      }
      if (ctx.sections && ctx.sections.length > 0) {
        const sectionSummary = ctx.sections
          .map(
            (s: { title: string; content: string }) =>
              `- ${s.title}: ${s.content.slice(0, 150)}...`,
          )
          .slice(0, 5)
          .join("\n");
        parts.push(`**已研究章节**:\n${sectionSummary}`);
      }
      if (ctx.conclusion) {
        parts.push(`**结论**: ${ctx.conclusion.slice(0, 300)}`);
      }
      if (ctx.iterationHistory) {
        // Cap iteration history to prevent context bloat (already pre-truncated
        // by buildIterationHistory, this is a second safety net)
        const cappedHistory =
          ctx.iterationHistory.length > 2000
            ? ctx.iterationHistory.slice(0, 2000) + "\n[...已截断]"
            : ctx.iterationHistory;
        parts.push(`**迭代历史**:\n${cappedHistory}`);
      }
      previousFindings = parts.join("\n\n");
    }

    // Round 1: 总监开场
    const directorOpener = isFollowUp
      ? op.directorOpenerFollowUp(dto.query, previousFindings)
      : op.directorOpener(dto.query);

    this.streamService.emitTyping(subject, director);
    const directorResponse = await this.streamService.withTimeout(
      this.agentService.speak(director, directorOpener, {
        creativity: "high",
        outputLength: "short",
      }),
      this.STAGE_TIMEOUT,
      "Director opening",
    );

    const msg1 = this.agentService.createMessage(
      director,
      directorResponse,
      "ideation",
      "proposal",
    );
    allMessages.push(msg1);
    this.streamService.publishMessage(sessionId, msg1, subject);

    // Round 2: 研究员们各自提 Ideas（并行）
    const researcherContext = op.researcherIdeation(directorResponse);

    this.streamService.emitTyping(subject, researcherA);
    const researcherResults = await Promise.allSettled([
      this.streamService.withTimeout(
        this.agentService.speak(researcherA, researcherContext, {
          creativity: "high",
          outputLength: "short",
        }),
        this.STAGE_TIMEOUT,
        "Researcher A ideation",
      ),
      this.streamService.withTimeout(
        this.agentService.speak(researcherB, researcherContext, {
          creativity: "high",
          outputLength: "short",
        }),
        this.STAGE_TIMEOUT,
        "Researcher B ideation",
      ),
      this.streamService.withTimeout(
        this.agentService.speak(researcherC, researcherContext, {
          creativity: "high",
          outputLength: "short",
        }),
        this.STAGE_TIMEOUT,
        "Researcher C ideation",
      ),
    ]);

    const researchers = [researcherA, researcherB, researcherC];
    const responses: string[] = [];

    for (let i = 0; i < researcherResults.length; i++) {
      const result = researcherResults[i];
      const agent = researchers[i];
      const resp =
        result.status === "fulfilled"
          ? result.value
          : language === "en-US"
            ? `[Analysis temporarily unavailable: ${result.reason instanceof Error ? result.reason.message : "unknown error"}]`
            : `[分析暂时不可用: ${result.reason instanceof Error ? result.reason.message : "未知错误"}]`;

      if (result.status === "rejected") {
        this.logger.warn(`Researcher ${i} ideation failed: ${result.reason}`);
      }

      responses.push(resp);
      const msg = this.agentService.createMessage(
        agent,
        resp,
        "ideation",
        "idea",
      );
      allMessages.push(msg);
      this.streamService.publishMessage(sessionId, msg, subject);
    }

    const [respA, respB, respC] = responses;

    // Round 3: 分析师挑战假设
    const analystContext = op.analystCritique(
      directorResponse,
      respA,
      respB,
      respC,
    );

    this.streamService.emitTyping(subject, analyst);
    const analystResponse = await this.streamService.withTimeout(
      this.agentService.speak(analyst, analystContext, {
        creativity: "medium",
        outputLength: "short",
      }),
      this.STAGE_TIMEOUT,
      "Analyst critique",
    );

    const msgAnalyst = this.agentService.createMessage(
      analyst,
      analystResponse,
      "ideation",
      "critique",
    );
    allMessages.push(msgAnalyst);
    this.streamService.publishMessage(sessionId, msgAnalyst, subject);

    // Round 4: 总监综合，确定研究方向
    const summaryContext = op.directorSummary(analystResponse);

    this.streamService.emitTyping(subject, director);
    const directorSummary = await this.streamService.withTimeout(
      this.agentService.speak(director, summaryContext, {
        creativity: "medium",
        outputLength: "short",
      }),
      this.STAGE_TIMEOUT,
      "Director summary",
    );

    const msgSummary = this.agentService.createMessage(
      director,
      directorSummary,
      "ideation",
      "synthesis",
    );
    allMessages.push(msgSummary);
    this.streamService.publishMessage(sessionId, msgSummary, subject);

    // 解析研究方向
    let directions = this.agentService.parseDirections(
      directorSummary,
      language,
    );

    // 确保有至少 2 个方向
    if (directions.length < 2) {
      const currentYear = new Date().getFullYear();
      const core = op.fallbackDirectionCore(dto.query);
      const impact = op.fallbackDirectionImpact(dto.query);
      const trends = op.fallbackDirectionTrends(dto.query);
      directions = [
        {
          ...core,
          searchQueries: [dto.query, `${dto.query} analysis`],
        },
        {
          ...impact,
          searchQueries: [`${dto.query} impact`, `${dto.query} application`],
        },
        {
          ...trends,
          searchQueries: [
            `${dto.query} trends ${currentYear} ${currentYear + 1}`,
            `${dto.query} future`,
          ],
        },
      ];
    }

    return directions;
  }

  // ==================== Phase 2: Execution ====================

  private async runExecutionPhase(
    sessionId: string,
    dto: StartDeepResearchDto,
    team: Map<string, AgentState>,
    directions: ResearchDirection[],
    searchRounds: SearchRound[],
    allMessages: DiscussionMessage[],
    subject: Subject<DeepResearchSSEEvent>,
    language: ResearchLanguage,
    toolStrategy?: ResearchToolStrategy,
  ): Promise<void> {
    const depth = dto.options?.depth || "standard";
    const maxRoundsPerDirection: Record<string, number> = {
      quick: 1,
      standard: 2,
      thorough: 3,
    };
    const roundsPerDir = maxRoundsPerDirection[depth] || 2;

    const op = ORCHESTRATOR_PROMPTS[language];
    const searchMsg = SEARCH_MESSAGES[language];

    // 按方向分配给研究员
    const researcherIds = ["researcher-a", "researcher-b", "researcher-c"];

    for (let dirIdx = 0; dirIdx < directions.length; dirIdx++) {
      const direction = directions[dirIdx];
      const researcherId = researcherIds[dirIdx % researcherIds.length];
      const researcher = this.streamService.getAgent(team, researcherId);

      // 状态更新
      const statusMsg = this.agentService.createMessage(
        researcher,
        op.executionStatus(direction.title),
        "execution",
        "status",
      );
      allMessages.push(statusMsg);
      this.streamService.publishMessage(sessionId, statusMsg, subject);

      // 执行搜索
      for (
        let roundIdx = 0;
        roundIdx < roundsPerDir && roundIdx < direction.searchQueries.length;
        roundIdx++
      ) {
        const query = direction.searchQueries[roundIdx] || direction.title;
        const roundNum = searchRounds.length + 1;

        // 搜索进度事件
        subject.next({
          type: "search_progress",
          data: {
            round: roundNum,
            totalRounds: directions.length * roundsPerDir,
            query,
            resultsCount: 0,
            message: searchMsg.searchProgress(researcher.config.name, query),
          },
        });

        const step: ResearchPlanStep = {
          id: `step_${dirIdx}_${roundIdx}`,
          type: roundIdx === 0 ? "initial_search" : "deep_dive",
          query,
          rationale: direction.description,
          estimatedSources: 10,
        };

        // ★ 使用工具路由解析本步骤的工具组合
        const stepResolution =
          toolStrategy && this.toolRouter
            ? this.toolRouter.resolveToolsForStep(
                step,
                toolStrategy.topicType,
                toolStrategy.stepOverrides,
              )
            : undefined;

        const round = await this.streamService.withTimeout(
          this.searchService.executeStep(step, roundNum, stepResolution),
          this.STAGE_TIMEOUT,
          `Search ${roundNum}`,
        );
        searchRounds.push(round);

        // 搜索完成事件
        subject.next({
          type: "search_progress",
          data: {
            round: roundNum,
            totalRounds: directions.length * roundsPerDir,
            query,
            resultsCount: round.resultsCount,
            message: searchMsg.searchComplete(
              researcher.config.name,
              round.resultsCount,
            ),
          },
        });

        // 短暂延迟避免限速
        await this.streamService.delay(ORCHESTRATOR_CONFIG.RATE_LIMIT_DELAY_MS);
      }
    }
  }

  // ==================== Phase 3: Findings ====================

  private async runFindingsPhase(
    sessionId: string,
    _dto: StartDeepResearchDto,
    team: Map<string, AgentState>,
    searchRounds: SearchRound[],
    allMessages: DiscussionMessage[],
    subject: Subject<DeepResearchSSEEvent>,
    language: ResearchLanguage,
  ): Promise<void> {
    const director = this.streamService.getAgent(team, "director");
    const analyst = this.streamService.getAgent(team, "analyst");
    const researcherIds = ["researcher-a", "researcher-b", "researcher-c"];

    const op = ORCHESTRATOR_PROMPTS[language];
    const searchMsg = SEARCH_MESSAGES[language];

    // 准备搜索结果摘要
    const sourceSummary = searchRounds
      .map(
        (r) =>
          `[${searchMsg.roundLabel(r.round)}] ${language === "en-US" ? `Query: "${r.query}" - found ${r.resultsCount} sources` : `查询: "${r.query}" - 找到 ${r.resultsCount} 个来源`}\n` +
          r.sources
            .slice(0, 3)
            .map((s) => `  - ${s.title}: ${s.snippet.slice(0, 100)}`)
            .join("\n"),
      )
      .join("\n\n");

    // 研究员汇报（并行）
    const findingsContext = op.findingsRequest(sourceSummary);

    const findingsPromises = researcherIds.map(async (id) => {
      const researcher = team.get(id);
      if (!researcher) {
        this.logger.warn(`Researcher ${id} not found in team`);
        return null;
      }
      this.streamService.emitTyping(subject, researcher);
      const findings = await this.streamService.withTimeout(
        this.agentService.speak(researcher, findingsContext, {
          creativity: "medium",
          outputLength: "short",
        }),
        this.STAGE_TIMEOUT,
        `${id} findings`,
      );
      return { researcher, findings };
    });

    const settledResults = await Promise.allSettled(findingsPromises);
    const allFindings = settledResults
      .filter(
        (
          r,
        ): r is PromiseFulfilledResult<{
          researcher: AgentState;
          findings: string;
        } | null> => r.status === "fulfilled" && r.value !== null,
      )
      .map((r) => r.value!);
    const findingsTexts: string[] = [];

    for (const { researcher, findings } of allFindings) {
      const msg = this.agentService.createMessage(
        researcher,
        findings,
        "findings",
        "findings",
      );
      allMessages.push(msg);
      this.streamService.publishMessage(sessionId, msg, subject);
      findingsTexts.push(`${researcher.config.name}：${findings}`);
    }

    // 分析师交叉验证 (★ 使用 fact-check + consistency-check 技能)
    const crossCheckContext = op.crossCheckRequest(findingsTexts.join("\n\n"));

    this.streamService.emitTyping(subject, analyst);
    const crossCheck = await this.streamService.withTimeout(
      this.agentService.speak(analyst, crossCheckContext, {
        creativity: "low",
        outputLength: "short",
        additionalSkills: [
          "fact-check",
          "consistency-check",
          "cross-reference-validation",
        ],
      }),
      this.STAGE_TIMEOUT,
      "Analyst cross-check",
    );

    const msgCrossCheck = this.agentService.createMessage(
      analyst,
      crossCheck,
      "findings",
      "cross_check",
    );
    allMessages.push(msgCrossCheck);
    this.streamService.publishMessage(sessionId, msgCrossCheck, subject);

    // 总监综合洞察 (★ 使用 synthesis + critical-thinking 技能)
    const insightContext = op.insightRequest(crossCheck);

    this.streamService.emitTyping(subject, director);
    const directorInsight = await this.streamService.withTimeout(
      this.agentService.speak(director, insightContext, {
        creativity: "medium",
        outputLength: "short",
        additionalSkills: ["synthesis", "critical-thinking", "gap-analysis"],
      }),
      this.STAGE_TIMEOUT,
      "Director insight",
    );

    const msgInsight = this.agentService.createMessage(
      director,
      directorInsight,
      "findings",
      "synthesis",
    );
    allMessages.push(msgInsight);
    this.streamService.publishMessage(sessionId, msgInsight, subject);
  }

  // ==================== Phase 4: Synthesis ====================

  private async runSynthesisPhase(
    sessionId: string,
    dto: StartDeepResearchDto,
    team: Map<string, AgentState>,
    searchRounds: SearchRound[],
    allMessages: DiscussionMessage[],
    subject: Subject<DeepResearchSSEEvent>,
    language: ResearchLanguage,
  ): Promise<DeepResearchReport> {
    const writer = this.streamService.getAgent(team, "writer");
    const reviewer = this.streamService.getAgent(team, "reviewer");

    const phaseMsg = PHASE_MESSAGES[language];
    const op = ORCHESTRATOR_PROMPTS[language];

    // 撰稿人开始写作通知
    const writeStartMsg = this.agentService.createMessage(
      writer,
      phaseMsg.writeStart,
      "synthesis",
      "status",
    );
    allMessages.push(writeStartMsg);
    this.streamService.publishMessage(sessionId, writeStartMsg, subject);

    // 生成完整报告（单次生成，避免双重 LLM 调用导致超时/OOM）
    this.streamService.emitTyping(subject, writer);
    const report = await this.streamService.withTimeout(
      this.reportService.generateReport(dto.query, searchRounds, {
        language: dto.options?.language,
        isFollowUp: dto.isFollowUp,
        previousContext: dto.previousContext,
      }),
      this.SYNTHESIS_TIMEOUT,
      "Report synthesis",
    );

    // ★ 质量门检查：自动修复格式问题
    if (this.qualityGate) {
      for (const section of report.sections) {
        const qr = this.qualityGate.validateReport(section.content);
        if (qr.wasAutoFixed && qr.fixedContent) {
          section.content = qr.fixedContent;
        }
      }
      const summaryQr = this.qualityGate.validateReport(
        report.executiveSummary,
      );
      if (summaryQr.wasAutoFixed && summaryQr.fixedContent) {
        report.executiveSummary = summaryQr.fixedContent;
      }
    }

    // ★ 事实检查 (fire-and-forget, 不阻塞主流程)
    if (this.factChecker && report.references.length > 0) {
      void this.factChecker
        .checkConsistency(
          report.sections
            .map((s) => `### ${s.title}\n${s.content}`)
            .join("\n\n"),
        )
        .then((result) => {
          if (result && !result.isConsistent) {
            this.logger.warn(
              `[FactChecker] Report has ${result.conflicts.length} consistency conflicts`,
            );
          }
        })
        .catch((err: unknown) => {
          this.logger.warn(
            `[FactChecker] consistency check failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
    }

    // 撰稿人完成通知
    const writeDoneMsg = this.agentService.createMessage(
      writer,
      phaseMsg.writeDone,
      "synthesis",
      "draft",
    );
    allMessages.push(writeDoneMsg);
    this.streamService.publishMessage(sessionId, writeDoneMsg, subject);

    // 审稿人评审
    const reviewContext = op.reviewRequest(
      report.executiveSummary.slice(0, 300),
      report.sections.length,
      report.references.length,
    );

    this.streamService.emitTyping(subject, reviewer);
    const reviewResponse = await this.streamService.withTimeout(
      this.agentService.speak(reviewer, reviewContext, {
        creativity: "low",
        outputLength: "minimal",
        modelType: AIModelType.CHAT_FAST,
      }),
      this.STAGE_TIMEOUT,
      "Review",
    );

    const reviewMsg = this.agentService.createMessage(
      reviewer,
      reviewResponse,
      "synthesis",
      "review",
    );
    allMessages.push(reviewMsg);
    this.streamService.publishMessage(sessionId, reviewMsg, subject);

    return report;
  }

  // ==================== AI Kernel 生命周期 ====================

  private completeKernelProcess(
    sessionId: string,
    output?: Record<string, unknown>,
  ): void {
    const processId = this.kernelProcessIds.get(sessionId);
    if (!processId || !this.missionExecutor) return;
    void this.missionExecutor
      .complete(processId, output)
      .catch((err) =>
        this.logger.warn(
          `[Kernel] Failed to complete process: ${(err as Error).message}`,
        ),
      );
    this.kernelProcessIds.delete(sessionId);
  }

  private failKernelProcess(sessionId: string, error: string): void {
    const processId = this.kernelProcessIds.get(sessionId);
    if (!processId || !this.missionExecutor) return;
    void this.missionExecutor
      .fail(processId, error)
      .catch((err) =>
        this.logger.warn(
          `[Kernel] Failed to fail process: ${(err as Error).message}`,
        ),
      );
    this.kernelProcessIds.delete(sessionId);
  }

  // ==================== 工具方法 ====================

  /**
   * Auto-extract insights from completed discussion.
   * Uses ResearchIdeaService for AI-powered extraction.
   */
  private async autoExtractIdeas(
    projectId: string,
    sessionId: string,
    _messages: DiscussionMessage[],
  ): Promise<void> {
    if (!this.ideaService) {
      this.logger.log(
        `Discussion ${sessionId} completed. Ideas available for manual extraction.`,
      );
      return;
    }

    // Get the project's userId for the extraction
    const project = await this.prisma.researchProject.findUnique({
      where: { id: projectId },
      select: { userId: true },
    });
    if (!project) return;

    this.logger.log(`Auto-extracting insights from session ${sessionId}...`);
    const ideas = await this.ideaService.extractFromSession(
      project.userId,
      projectId,
      sessionId,
    );
    this.logger.log(
      `Auto-extracted ${ideas.length} insights from session ${sessionId}`,
    );
  }
}
