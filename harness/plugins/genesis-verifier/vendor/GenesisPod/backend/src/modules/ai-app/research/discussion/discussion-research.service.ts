import { Injectable, Logger, Optional } from "@nestjs/common";
import { Subject, Observable } from "rxjs";
import { PrismaService } from "../../../../common/prisma/prisma.service";
import { DeepResearchStatus } from "@prisma/client";
import { ResearchPlannerService } from "./research-planner.service";
import { IterativeSearchService } from "./iterative-search.service";
import { SelfReflectionService } from "./self-reflection.service";
import { ReportSynthesizerService } from "./report-synthesizer.service";
import {
  StartDeepResearchDto,
  DeepResearchSSEEvent,
  DeepResearchReport,
  SearchRound,
  Reflection,
  ThinkingStep,
} from "./types";
import {
  CreditsService,
  InsufficientCreditsException,
  BillingContext,
} from "../../../platform/facade";
import {
  MissionContext,
  MissionExecutorService,
} from "@/modules/ai-harness/facade";

/**
 * 讨论式研究服务
 * 协调规划、搜索、反思、报告生成的完整流程
 */
@Injectable()
export class DiscussionResearchService {
  private readonly logger = new Logger(DiscussionResearchService.name);

  // 单个阶段的最大超时时间 (2 分钟)
  private readonly STAGE_TIMEOUT = 2 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly plannerService: ResearchPlannerService,
    private readonly searchService: IterativeSearchService,
    private readonly reflectionService: SelfReflectionService,
    private readonly reportService: ReportSynthesizerService,
    @Optional() private readonly creditsService: CreditsService,
    @Optional() private readonly missionExecutor?: MissionExecutorService,
  ) {}

  /**
   * 启动深度研究并返回 SSE 事件流
   */
  startResearch(
    projectId: string,
    dto: StartDeepResearchDto,
  ): Observable<DeepResearchSSEEvent> {
    const subject = new Subject<DeepResearchSSEEvent>();

    // 异步执行研究流程 (包装在 BillingContext 中)
    (async () => {
      // 先获取项目信息以获取 userId
      const project = await this.prisma.researchProject.findUnique({
        where: { id: projectId },
        select: { userId: true },
      });

      if (!project) {
        throw new Error("Project not found");
      }

      const depth = dto.options?.depth || "standard";
      const userId = project.userId;

      // ★ AI Kernel: 创建进程
      let kernelProcessId: string | undefined;
      if (this.missionExecutor) {
        try {
          const kr = await this.missionExecutor.execute({
            userId,
            agentId: "discussion-research",
            input: {
              action: `research-${depth}`,
              query: dto.query.slice(0, 100),
            },
          });
          kernelProcessId = kr.processId;
        } catch {
          /* kernel optional */
        }
      }

      // 在 BillingContext 中执行研究，会自动处理积分扣减
      const billingRun = () =>
        BillingContext.run(
          {
            userId,
            moduleType: "deep-research",
            operationType: `research-${depth}`,
            description: `Deep Research (${depth}) - ${dto.query.slice(0, 50)}...`,
          },
          async () => {
            await this.executeResearch(projectId, dto, subject);
          },
        );

      try {
        await (kernelProcessId
          ? MissionContext.run(
              { agentProcessId: kernelProcessId, userId },
              billingRun,
            )
          : billingRun());
        if (kernelProcessId && this.missionExecutor) {
          void this.missionExecutor
            .complete(kernelProcessId)
            .catch((err) =>
              this.logger.debug("Mission completion cleanup failed", err),
            );
        }
      } catch (error) {
        if (kernelProcessId && this.missionExecutor) {
          void this.missionExecutor
            .fail(
              kernelProcessId,
              error instanceof Error ? error.message : String(error),
            )
            .catch((err) =>
              this.logger.debug("Mission failure cleanup failed", err),
            );
        }
        throw error;
      }
    })().catch((error) => {
      this.logger.error(`Research execution failed: ${error}`);
      subject.next({
        type: "error",
        data: {
          code: "EXECUTION_ERROR",
          message: error.message || "研究执行失败",
          recoverable: false,
        },
      });
      subject.complete();
    });

    return subject.asObservable();
  }

  /**
   * 无状态直接研究 — 为 MCP Server 等外部调用方设计
   *
   * 与 startResearch() 不同：
   * - 不需要 projectId，不持久化到数据库
   * - 不发送 SSE 事件，不检查积分
   * - 同步返回完整报告结果
   */
  async executeDirectResearch(params: {
    query: string;
    depth?: "quick" | "standard" | "deep";
    language?: string;
    dimensions?: string[];
    /** 进度回调：每个阶段完成后通知调用方（stage, 0-100, message） */
    onProgress?: (stage: string, percent: number, message: string) => void;
  }): Promise<{
    report: DeepResearchReport;
    searchRounds: SearchRound[];
    duration: number;
  }> {
    const startTime = Date.now();
    const depth = params.depth || "standard";
    const depthConfig: Record<
      string,
      { maxRounds: number; plannerDepth: "quick" | "standard" | "thorough" }
    > = {
      quick: { maxRounds: 2, plannerDepth: "quick" },
      standard: { maxRounds: 4, plannerDepth: "standard" },
      deep: { maxRounds: 8, plannerDepth: "thorough" },
    };
    const config = depthConfig[depth] || depthConfig.standard;

    const enrichedQuery = params.dimensions?.length
      ? `${params.query}\n\nFocus dimensions: ${params.dimensions.join(", ")}`
      : params.query;

    const { onProgress } = params;

    // 阶段 1: 规划
    onProgress?.("planning", 5, "Creating research plan...");
    const plan = await this.withTimeout(
      this.plannerService.generatePlan(enrichedQuery, {
        depth: config.plannerDepth,
      }),
      this.STAGE_TIMEOUT,
      "Research planning",
    );
    onProgress?.("planning_complete", 15, "Research plan ready");

    // 阶段 2: 迭代搜索 + 反思
    const maxRounds = config.maxRounds;
    const searchRounds: SearchRound[] = [];
    let currentRound = 0;
    let stepIndex = 0;

    while (currentRound < maxRounds && stepIndex < plan.steps.length) {
      const step = plan.steps[stepIndex];
      currentRound++;

      // 搜索进度: 15% + (轮次进度 * 65%)，搜索占每轮的 60%
      const roundBase = 15 + ((currentRound - 1) / maxRounds) * 65;
      onProgress?.(
        "searching",
        Math.round(roundBase + (1 / maxRounds) * 65 * 0.6),
        `Searching round ${currentRound}/${maxRounds}: ${step.query.slice(0, 60)}...`,
      );

      const round = await this.withTimeout(
        this.searchService.executeStep(step, currentRound),
        this.STAGE_TIMEOUT,
        `Search step ${currentRound}`,
      );
      searchRounds.push(round);

      // 反思（跳过最后一轮）
      if (currentRound < maxRounds && currentRound >= 2) {
        try {
          onProgress?.(
            "reflecting",
            Math.round(roundBase + (1 / maxRounds) * 65 * 0.85),
            `Evaluating search quality (round ${currentRound})...`,
          );

          const reflection = await this.withTimeout(
            this.reflectionService.reflect(
              enrichedQuery,
              plan,
              searchRounds,
              currentRound,
              maxRounds,
            ),
            this.STAGE_TIMEOUT,
            `Reflection ${currentRound}`,
          );

          if (
            !this.reflectionService.shouldContinue(
              reflection,
              currentRound,
              maxRounds,
            )
          ) {
            break;
          }

          if (reflection.decision === "pivot" && reflection.nextSteps) {
            const pivotSteps = this.reflectionService.generatePivotSteps(
              reflection,
              plan,
              currentRound,
            );
            plan.steps.push(...pivotSteps);
          }
        } catch {
          // 反思失败时根据阶段决定
          onProgress?.(
            "reflecting_skipped",
            Math.round(roundBase + (1 / maxRounds) * 65 * 0.85),
            `Reflection skipped (round ${currentRound}), continuing...`,
          );
          if (currentRound >= maxRounds * 0.5) {
            break; // 后期阶段直接结束
          }
          // 早期阶段继续搜索
        }
      }

      stepIndex++;
    }

    // 阶段 3: 合成报告
    onProgress?.("synthesizing", 82, "Generating final research report...");
    const report = await this.withTimeout(
      this.reportService.generateReport(enrichedQuery, searchRounds, {
        language: params.language,
      }),
      this.STAGE_TIMEOUT,
      "Report synthesis",
    );
    onProgress?.("synthesis_complete", 98, "Report ready");

    return {
      report,
      searchRounds,
      duration: Math.round((Date.now() - startTime) / 1000),
    };
  }

  /**
   * 执行完整研究流程
   */
  private async executeResearch(
    projectId: string,
    dto: StartDeepResearchDto,
    subject: Subject<DeepResearchSSEEvent>,
  ): Promise<void> {
    const startTime = Date.now();
    const maxRounds = dto.options?.maxRounds || 5;
    const thinkingChain: ThinkingStep[] = [];
    const searchRounds: SearchRound[] = [];
    const reflections: Reflection[] = [];

    // 获取项目信息以获取 userId
    const project = await this.prisma.researchProject.findUnique({
      where: { id: projectId },
      select: { userId: true },
    });

    if (!project) {
      throw new Error("Project not found");
    }

    const userId = project.userId;

    // 积分检查：根据研究深度确定积分消耗
    const depth = dto.options?.depth || "standard";
    const creditsMap: Record<string, number> = {
      quick: 200,
      standard: 500,
      deep: 1000,
    };
    const estimatedCredits = creditsMap[depth] || 500;

    if (this.creditsService) {
      const balanceCheck = await this.creditsService.checkBalance(
        userId,
        estimatedCredits,
      );
      if (!balanceCheck.sufficient) {
        throw new InsufficientCreditsException(
          estimatedCredits,
          balanceCheck.balance,
        );
      }
    }

    // 创建研究会话
    const session = await this.prisma.deepResearchSession.create({
      data: {
        projectId,
        query: dto.query,
        status: DeepResearchStatus.PLANNING,
      },
    });

    try {
      // ========== 阶段 1: 规划 ==========
      const isFollowUp = dto.isFollowUp ?? false;
      const previousContext = dto.previousContext;

      this.emitThinking(
        subject,
        thinkingChain,
        "analyzing_query",
        isFollowUp
          ? `正在分析追问内容: "${dto.query.slice(0, 50)}..."`
          : `正在分析研究主题: "${dto.query.slice(0, 50)}..."`,
      );

      this.emitThinking(
        subject,
        thinkingChain,
        "planning_research",
        isFollowUp
          ? "正在规划补充研究步骤，确定扩展方向..."
          : "正在制定研究计划，确定搜索步骤...",
      );

      const plan = await this.withTimeout(
        this.plannerService.generatePlan(dto.query, {
          depth: dto.options?.depth,
          includeAcademic: dto.options?.includeAcademic,
          isFollowUp,
          previousContext,
        }),
        this.STAGE_TIMEOUT,
        "研究计划生成",
      );

      // 发送计划就绪事件
      subject.next({
        type: "plan_ready",
        data: { plan },
      });

      // 更新会话状态
      await this.updateSession(session.id, {
        status: DeepResearchStatus.SEARCHING,
        plan: plan as unknown as Record<string, unknown>,
        thinkingChain: thinkingChain as unknown as Record<string, unknown>[],
      });

      // ========== 阶段 2: 迭代搜索 ==========
      let currentRound = 0;
      let continueSearching = true;

      while (continueSearching && currentRound < maxRounds) {
        const stepsToExecute =
          currentRound === 0 ? plan.steps : plan.steps.slice(currentRound);

        for (const step of stepsToExecute) {
          if (currentRound >= maxRounds) break;

          currentRound++;

          this.emitThinking(
            subject,
            thinkingChain,
            "executing_search",
            `执行搜索步骤 ${currentRound}/${maxRounds}: ${step.query.slice(0, 50)}...`,
          );

          // 发送搜索进度
          subject.next({
            type: "search_progress",
            data: {
              round: currentRound,
              totalRounds: maxRounds,
              query: step.query,
              resultsCount: 0,
              message: `正在搜索: ${step.type}`,
            },
          });

          // 执行搜索 (带超时保护)
          const round = await this.withTimeout(
            this.searchService.executeStep(step, currentRound),
            this.STAGE_TIMEOUT,
            `搜索步骤 ${currentRound}`,
          );
          searchRounds.push(round);

          // 更新搜索进度
          subject.next({
            type: "search_progress",
            data: {
              round: currentRound,
              totalRounds: maxRounds,
              query: step.query,
              resultsCount: round.resultsCount,
              message: `找到 ${round.resultsCount} 个结果`,
            },
          });

          // ========== 阶段 2.5: 反思 ==========
          if (currentRound >= 2) {
            // 至少搜索两轮后开始反思
            this.emitThinking(
              subject,
              thinkingChain,
              "reflecting",
              "正在评估搜索结果质量...",
            );

            await this.updateSession(session.id, {
              status: DeepResearchStatus.REFLECTING,
            });

            // 反思评估 (带超时保护)
            const reflection = await this.withTimeout(
              this.reflectionService.reflect(
                dto.query,
                plan,
                searchRounds,
                currentRound,
                maxRounds,
              ),
              this.STAGE_TIMEOUT,
              `反思评估 (轮次 ${currentRound})`,
            );
            reflections.push(reflection);

            // 发送反思事件
            subject.next({
              type: "reflection",
              data: {
                assessment: reflection.assessment,
                decision: reflection.decision,
                reasoning: reflection.reasoning,
              },
            });

            // 检查是否需要继续
            if (
              !this.reflectionService.shouldContinue(
                reflection,
                currentRound,
                maxRounds,
              )
            ) {
              continueSearching = false;
              break;
            }

            // 如果需要调整方向
            if (reflection.decision === "pivot" && reflection.nextSteps) {
              const pivotSteps = this.reflectionService.generatePivotSteps(
                reflection,
                plan,
                currentRound,
              );
              plan.steps.push(...pivotSteps);
            }
          }
        }
      }

      // 更新搜索结果到会话
      await this.updateSession(session.id, {
        searchRounds: searchRounds as unknown as Record<string, unknown>[],
        reflections: reflections as unknown as Record<string, unknown>[],
        thinkingChain: thinkingChain as unknown as Record<string, unknown>[],
      });

      // ========== 阶段 3: 合成报告 ==========
      this.emitThinking(
        subject,
        thinkingChain,
        "synthesizing",
        isFollowUp
          ? "正在综合新搜索结果，扩展研究报告..."
          : "正在综合搜索结果，生成研究报告...",
      );

      await this.updateSession(session.id, {
        status: DeepResearchStatus.SYNTHESIZING,
      });

      // 生成完整报告（单次调用，消除原有双重 LLM 合成的重复开销）
      // 报告完成后逐段发送 content.delta，保持前端接口兼容
      const report = await this.withTimeout(
        this.reportService.generateReport(dto.query, searchRounds, {
          language: dto.options?.language,
          isFollowUp,
          previousContext,
        }),
        this.STAGE_TIMEOUT,
        "报告生成",
      );

      subject.next({
        type: "content.delta",
        data: { section: "executive_summary", delta: report.executiveSummary },
      });
      for (const section of report.sections) {
        subject.next({
          type: "content.delta",
          data: { section: section.title, delta: section.content },
        });
      }
      if (report.conclusion) {
        subject.next({
          type: "content.delta",
          data: { section: "conclusion", delta: report.conclusion },
        });
      }

      // ========== 完成 ==========
      this.emitThinking(
        subject,
        thinkingChain,
        "formatting",
        "正在格式化输出...",
      );

      const totalSources = this.countUniqueSources(searchRounds);
      const duration = Date.now() - startTime;

      // 更新最终状态
      await this.updateSession(session.id, {
        status: DeepResearchStatus.COMPLETED,
        report: report as unknown as Record<string, unknown>,
        thinkingChain: thinkingChain as unknown as Record<string, unknown>[],
        sourcesUsed: totalSources,
        completedAt: new Date(),
      });

      // 发送完成事件
      subject.next({
        type: "interaction.complete",
        data: {
          sessionId: session.id,
          report,
          status: "success",
        },
      });

      this.logger.log(
        `Research completed: ${session.id}, sources: ${totalSources}, duration: ${duration}ms`,
      );
    } catch (error) {
      // 更新失败状态
      await this.updateSession(session.id, {
        status: DeepResearchStatus.FAILED,
        error: error instanceof Error ? error.message : String(error),
      });

      throw error;
    } finally {
      subject.complete();
    }
  }

  /**
   * 获取研究会话
   */
  async getSession(sessionId: string) {
    return this.prisma.deepResearchSession.findUnique({
      where: { id: sessionId },
    });
  }

  /**
   * 获取项目的研究会话列表
   */
  async getProjectSessions(projectId: string) {
    return this.prisma.deepResearchSession.findMany({
      where: { projectId, mode: { not: "iterative_internal" } },
      orderBy: { createdAt: "desc" },
      take: 10,
    });
  }

  /**
   * 删除研究会话
   */
  async deleteSession(sessionId: string) {
    return this.prisma.deepResearchSession.delete({
      where: { id: sessionId },
    });
  }

  /**
   * 批量删除研究会话
   */
  async deleteSessions(sessionIds: string[]) {
    return this.prisma.deepResearchSession.deleteMany({
      where: { id: { in: sessionIds } },
    });
  }

  /**
   * 发送思考链事件
   */
  private emitThinking(
    subject: Subject<DeepResearchSSEEvent>,
    thinkingChain: ThinkingStep[],
    step: ThinkingStep["step"],
    content: string,
  ): void {
    const thinkingStep: ThinkingStep = {
      step,
      content,
      timestamp: new Date(),
    };
    thinkingChain.push(thinkingStep);

    subject.next({
      type: "thought_summary",
      data: {
        step,
        content,
        timestamp: new Date().toISOString(),
      },
    });
  }

  /**
   * 更新会话状态
   */
  private async updateSession(
    sessionId: string,
    data: {
      status?: DeepResearchStatus;
      plan?: unknown;
      searchRounds?: unknown;
      reflections?: unknown;
      thinkingChain?: unknown;
      report?: unknown;
      sourcesUsed?: number;
      tokensUsed?: number;
      error?: string;
      completedAt?: Date;
    },
  ) {
    return this.prisma.deepResearchSession.update({
      where: { id: sessionId },
      data: data as never,
    });
  }

  /**
   * 统计唯一来源数
   */
  private countUniqueSources(searchRounds: SearchRound[]): number {
    const urls = new Set<string>();
    for (const round of searchRounds) {
      for (const source of round.sources) {
        urls.add(source.url);
      }
    }
    return urls.size;
  }

  /**
   * 带超时的 Promise 包装器
   */
  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    operationName: string,
  ): Promise<T> {
    let timeoutId: NodeJS.Timeout;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`${operationName} 超时 (${timeoutMs / 1000}秒)`));
      }, timeoutMs);
    });

    try {
      const result = await Promise.race([promise, timeoutPromise]);
      clearTimeout(timeoutId!);
      return result;
    } catch (error) {
      clearTimeout(timeoutId!);
      throw error;
    }
  }
}
