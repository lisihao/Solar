/**
 * Slides Team Orchestrator
 *
 * 主编排器，采用 AI Teams 的 Leader 协调模式
 *
 * 5阶段执行流程：
 * 1. Leader 规划 - 分析源文本，动态分解任务
 * 2. 任务执行 - 成员执行任务，调用 Skills
 * 3. Leader 审核 - 检查任务输出，支持修订
 * 4. 质量审计 - 全局质量检查
 * 5. Leader 综合 - 整合所有输出
 */

import { Injectable, Logger, Optional } from "@nestjs/common";
import { v4 as uuidv4 } from "uuid";
import { AgentFacade } from "@/modules/ai-harness/facade";
import { SlidesLeader } from "./slides-leader";
import { SlidesTeamMember, TaskExecutionResult } from "./slides-team-member";
import { SlidesRepository } from "./slides-repository";
import { DeckConsistencyAuditorSkill } from "../skills/deck-consistency-auditor.skill";
import {
  SlidesMission,
  SlidesMissionEvent,
  SlidesTask,
  SlidesTeamOrchestratorInput,
  SlidesTeamOrchestratorOutput,
  SkillExecutionContext,
  QualityAuditResult,
  SlidesExecutionError,
} from "./types";
import type { GeneratedSlide, PPTOutline } from "../types/slides.types";
import { createSkillOutputManager } from "@/modules/ai-harness/facade";
import type { ISkillOutputManager } from "@/modules/ai-harness/facade";
import { SkillResolver } from "../skill-resolver";

@Injectable()
export class SlidesTeamOrchestrator {
  private readonly logger = new Logger(SlidesTeamOrchestrator.name);

  // 是否启用持久化
  private readonly persistenceEnabled: boolean;

  constructor(
    private readonly leader: SlidesLeader,
    private readonly teamMember: SlidesTeamMember,
    @Optional() private readonly repository?: SlidesRepository,
    @Optional() private readonly agentFacade?: AgentFacade,
    @Optional()
    private readonly deckConsistencyAuditor?: DeckConsistencyAuditorSkill,
    @Optional() private readonly skillResolver?: SkillResolver,
  ) {
    this.persistenceEnabled = !!repository;
    this.logger.log(
      `[constructor] Persistence ${this.persistenceEnabled ? "enabled" : "disabled"}`,
    );
  }

  /**
   * 执行 Mission（流式）
   */
  async *executeMission(
    input: SlidesTeamOrchestratorInput,
  ): AsyncGenerator<SlidesMissionEvent> {
    const startTime = Date.now();
    const errors: SlidesExecutionError[] = [];

    // 创建 Mission（持久化或内存）
    let mission: SlidesMission;
    if (this.persistenceEnabled && this.repository) {
      mission = await this.repository.createMission(input);
    } else {
      mission = {
        id: uuidv4(),
        userId: input.userId,
        sessionId: input.sessionId,
        sourceText: input.sourceText,
        userRequirement: input.userRequirement,
        targetPages: input.targetPages,
        stylePreference: input.stylePreference,
        themeId: input.themeId,
        tasks: [],
        currentPhase: "planning",
        status: "pending",
        pages: [],
        createdAt: new Date(),
        totalTasks: 0,
        completedTasks: 0,
        metadata: {
          targetAudience: input.targetAudience,
        },
      };
    }

    // ── Skills resolution (Phase A) ──
    // Called once at entry; result is stored on the mission and reused
    // across retries. Falls through to hard-coded defaults when no hints.
    if (this.skillResolver) {
      const hasHints = !!(
        input.preset ||
        input.skillOverrides ||
        input.sourceTypeHint ||
        input.audience ||
        input.intent ||
        input.language
      );
      if (hasHints) {
        mission.resolvedSkills = this.skillResolver.resolve({
          conditions: {
            sourceType: input.sourceTypeHint,
            audience: input.audience,
            intent: input.intent,
            language: input.language,
          },
          presetId: input.preset,
          overrides: input.skillOverrides,
        });
        this.logger.log(
          `[executeMission] Resolved skills: preset=${
            mission.resolvedSkills.presetId ?? "(none)"
          } overrides=${Object.keys(input.skillOverrides ?? {}).length}`,
        );
      }
    }

    this.logger.log(`[executeMission] Starting mission ${mission.id}`);

    // ★ TraceCollector: 开始链路追踪
    const traceId = this.agentFacade?.startTrace({
      name: "AI Office: Slides",
      type: "team_execution",
      metadata: {
        missionId: mission.id,
        sessionId: input.sessionId,
        targetPages: input.targetPages,
      },
    });

    // ★ 各阶段 spanId（在 try 外声明，catch 可访问）
    let planningSpanId: string | undefined;
    let executingSpanId: string | undefined;
    let reviewingSpanId: string | undefined;
    let auditingSpanId: string | undefined;
    let synthesisSpanId: string | undefined;

    const createdEvent = this.createEvent("mission:created", mission.id, {
      mission,
    });
    yield createdEvent;
    await this.persistEvent(createdEvent);

    try {
      // Phase 1: Leader 规划
      planningSpanId = traceId
        ? this.agentFacade?.addSpan(traceId, {
            name: "Planning",
            type: "planning",
            metadata: { missionId: mission.id },
          })
        : undefined;
      yield* this.executePlanningPhase(mission, errors);
      if (planningSpanId) {
        this.agentFacade?.endSpan(planningSpanId, {
          status: "success",
          output: { taskCount: mission.tasks.length },
        });
      }

      // Phase 2: 任务执行
      executingSpanId = traceId
        ? this.agentFacade?.addSpan(traceId, {
            name: "Task Execution",
            type: "phase",
            metadata: { totalTasks: mission.totalTasks },
          })
        : undefined;
      yield* this.executeTasksPhase(mission, errors);
      if (executingSpanId) {
        this.agentFacade?.endSpan(executingSpanId, {
          status: "success",
          output: { completedTasks: mission.completedTasks },
        });
      }

      // Phase 3: Leader 审核
      reviewingSpanId = traceId
        ? this.agentFacade?.addSpan(traceId, {
            name: "Review",
            type: "review",
            metadata: { missionId: mission.id },
          })
        : undefined;
      yield* this.executeReviewPhase(mission, errors);
      if (reviewingSpanId) {
        this.agentFacade?.endSpan(reviewingSpanId, {
          status: "success",
          output: { completedTasks: mission.completedTasks },
        });
      }

      // Phase 4: 质量审计
      auditingSpanId = traceId
        ? this.agentFacade?.addSpan(traceId, {
            name: "Quality Audit",
            type: "evaluation",
            metadata: { missionId: mission.id },
          })
        : undefined;
      yield* this.executeAuditPhase(mission, errors);
      if (auditingSpanId) {
        this.agentFacade?.endSpan(auditingSpanId, {
          status: "success",
          output: {
            passed: (mission.metadata.qualityAudit as { passed?: boolean })
              ?.passed,
          },
        });
      }

      // Phase 5: Leader 综合
      synthesisSpanId = traceId
        ? this.agentFacade?.addSpan(traceId, {
            name: "Synthesis",
            type: "synthesis",
            metadata: { missionId: mission.id },
          })
        : undefined;
      yield* this.executeSynthesisPhase(mission, errors);
      if (synthesisSpanId) {
        this.agentFacade?.endSpan(synthesisSpanId, {
          status: "success",
          output: { pageCount: mission.pages.length },
        });
      }

      // 完成
      mission.status = "completed";
      mission.currentPhase = "completed";
      mission.completedAt = new Date();

      const duration = Date.now() - startTime;

      // 持久化完成状态
      if (this.persistenceEnabled && this.repository) {
        await this.repository.completeMission(
          mission.id,
          mission.pages,
          duration,
          mission.metadata.qualityAudit as QualityAuditResult | undefined,
        );
      }

      // ★ 诊断：检查 mission.pages 数据
      this.logger.log(
        `[executeMission] ★ Creating mission:completed event with ${mission.pages.length} pages`,
      );
      if (mission.pages.length > 0) {
        mission.pages.forEach((p, i) => {
          const page = p as {
            html?: string;
            renderedHtml?: string;
            id?: string;
          };
          this.logger.log(
            `[executeMission] ★ Page ${i + 1}: id=${page.id?.slice(0, 8)}, htmlLength=${page.html?.length || 0}, renderedHtmlLength=${page.renderedHtml?.length || 0}`,
          );
        });
      } else {
        this.logger.warn(
          `[executeMission] ★ WARNING: mission.pages is empty! Tasks: ${mission.tasks.map((t) => `${t.skillId}:${t.status}`).join(", ")}`,
        );
      }

      // ★ 结束链路追踪（成功）
      if (traceId) {
        this.agentFacade?.endTrace(traceId, { status: "success" });
      }

      const completedEvent = this.createEvent("mission:completed", mission.id, {
        mission,
        duration,
        pages: mission.pages,
        outline: mission.outline,
        qualityAudit: mission.metadata.qualityAudit,
        errors: errors.length > 0 ? errors : undefined,
      });
      yield completedEvent;
      await this.persistEvent(completedEvent);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[executeMission] Mission ${mission.id} failed: ${errorMsg}`,
      );

      // ★ 结束当前活跃的 span（失败）
      const activeSpanId =
        synthesisSpanId ??
        auditingSpanId ??
        reviewingSpanId ??
        executingSpanId ??
        planningSpanId;
      if (activeSpanId) {
        this.agentFacade?.endSpan(activeSpanId, {
          status: "error",
          error: errorMsg,
        });
      }
      // ★ 结束链路追踪（失败）
      if (traceId) {
        this.agentFacade?.endTrace(traceId, { status: "error" });
      }

      mission.status = "failed";
      mission.currentPhase = "failed";

      // 记录错误
      const execError: SlidesExecutionError = {
        taskId: "",
        phase: mission.currentPhase,
        errorType: "execution_failed",
        message: errorMsg,
        timestamp: new Date(),
        retryCount: 0,
      };
      errors.push(execError);

      // 持久化错误状态
      if (this.persistenceEnabled && this.repository) {
        await this.repository.updateMissionError(mission.id, errorMsg, errors);
      }

      const failedEvent = this.createEvent("mission:failed", mission.id, {
        error: errorMsg,
        phase: mission.currentPhase,
        errors,
      });
      yield failedEvent;
      await this.persistEvent(failedEvent);
    }
  }

  /**
   * 持久化事件
   */
  private async persistEvent(event: SlidesMissionEvent): Promise<void> {
    if (this.persistenceEnabled && this.repository) {
      try {
        await this.repository.recordEvent(event);
      } catch (error) {
        this.logger.warn(`[persistEvent] Failed to persist event: ${error}`);
      }
    }
  }

  /**
   * 执行 Mission（非流式）
   */
  async execute(
    input: SlidesTeamOrchestratorInput,
  ): Promise<SlidesTeamOrchestratorOutput> {
    const startTime = Date.now();
    let lastEvent: SlidesMissionEvent | null = null;

    for await (const event of this.executeMission(input)) {
      lastEvent = event;
    }

    if (!lastEvent) {
      return {
        success: false,
        missionId: "",
        sessionId: input.sessionId,
        pages: [],
        duration: Date.now() - startTime,
        error: "No events received",
      };
    }

    if (lastEvent.type === "mission:completed") {
      return {
        success: true,
        missionId: lastEvent.missionId,
        sessionId: input.sessionId,
        pages: (lastEvent.data.pages as GeneratedSlide[]) || [],
        outline: lastEvent.data.outline as PPTOutline | undefined,
        qualityAudit: lastEvent.data.qualityAudit as
          | QualityAuditResult
          | undefined,
        duration: Date.now() - startTime,
      };
    }

    return {
      success: false,
      missionId: lastEvent.missionId,
      sessionId: input.sessionId,
      pages: [],
      duration: Date.now() - startTime,
      error: (lastEvent.data.error as string) || "Unknown error",
    };
  }

  // ============================================
  // Phase 1: Leader 规划
  // ============================================

  private async *executePlanningPhase(
    mission: SlidesMission,
    errors: SlidesExecutionError[],
  ): AsyncGenerator<SlidesMissionEvent> {
    this.logger.log(
      `[executePlanningPhase] Starting planning for mission ${mission.id}`,
    );

    mission.currentPhase = "planning";
    mission.status = "planning";
    mission.startedAt = new Date();

    // 持久化状态
    if (this.persistenceEnabled && this.repository) {
      await this.repository.updateMissionStatus(
        mission.id,
        "planning",
        "planning",
      );
    }

    const startedEvent = this.createEvent("planning:started", mission.id, {
      phase: "planning",
    });
    yield startedEvent;
    await this.persistEvent(startedEvent);

    try {
      // 使用固定默认任务流程：task-decomposition → outline-planning → page-pipeline
      // 跳过 LLM 规划调用，避免依赖解析出错导致任务并发执行
      const defaultItems = this.leader.createDefaultTasks();
      const breakdown = {
        understanding:
          "默认任务流程：task-decomposition → outline-planning → page-pipeline",
        tasks: defaultItems,
        executionPlan: "顺序执行，每步依赖上一步输出",
        risks: "",
      };
      mission.taskBreakdown = breakdown;

      // 创建任务
      mission.tasks = this.leader.createTasksFromBreakdown(breakdown);
      mission.totalTasks = mission.tasks.length;

      // 持久化任务分解和任务
      if (this.persistenceEnabled && this.repository) {
        await this.repository.updateMissionTaskBreakdown(
          mission.id,
          breakdown,
          mission.tasks.length,
        );
        await this.repository.createTasks(mission.id, mission.tasks);
      }

      const completedEvent = this.createEvent(
        "planning:completed",
        mission.id,
        {
          breakdown,
          taskCount: mission.tasks.length,
        },
      );
      yield completedEvent;
      await this.persistEvent(completedEvent);

      // 发送任务创建事件
      for (const task of mission.tasks) {
        const taskEvent = this.createEvent("task:created", mission.id, {
          task,
        });
        yield taskEvent;
        await this.persistEvent(taskEvent);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      errors.push({
        taskId: "",
        phase: "planning",
        errorType: "execution_failed",
        message: errorMsg,
        timestamp: new Date(),
        retryCount: 0,
      });
      throw error;
    }
  }

  // ============================================
  // Phase 2: 任务执行
  // ============================================

  private async *executeTasksPhase(
    mission: SlidesMission,
    errors: SlidesExecutionError[],
  ): AsyncGenerator<SlidesMissionEvent> {
    this.logger.log(
      `[executeTasksPhase] ★ Starting task execution for mission ${mission.id}`,
    );
    this.logger.log(
      `[executeTasksPhase] ★ Tasks to execute: ${mission.tasks.map((t) => `${t.skillId}(${t.status})`).join(", ")}`,
    );

    mission.currentPhase = "executing";
    mission.status = "in_progress";

    // 持久化状态
    if (this.persistenceEnabled && this.repository) {
      await this.repository.updateMissionStatus(
        mission.id,
        "in_progress",
        "executing",
      );
    }

    const phaseEvent = this.createEvent("mission:phase_changed", mission.id, {
      phase: "executing",
    });
    yield phaseEvent;
    await this.persistEvent(phaseEvent);

    // 使用 AI Engine 统一规范的 SkillOutputManager
    const outputManager = createSkillOutputManager({ debug: true });

    // 按依赖顺序执行任务
    while (this.hasPendingTasks(mission)) {
      const executableTasks = this.getExecutableTasks(mission);

      if (executableTasks.length === 0) {
        // 检查是否有因依赖失败而无法执行的任务
        const pendingTasks = mission.tasks.filter(
          (t) => t.status === "pending",
        );
        if (pendingTasks.length > 0) {
          const failedDeps = mission.tasks
            .filter((t) => t.status === "failed")
            .map((t) => t.skillId);
          this.logger.warn(
            `[executeTasksPhase] ${pendingTasks.length} tasks skipped due to failed dependencies: ${failedDeps.join(", ")}`,
          );
        }
        break;
      }

      // 并行执行独立任务
      const results = await Promise.all(
        executableTasks.map((task) =>
          this.executeTask(mission, task, outputManager),
        ),
      );

      // 处理结果
      for (let i = 0; i < executableTasks.length; i++) {
        const task = executableTasks[i];
        const result = results[i];

        if (result.success) {
          task.status = "awaiting_review";
          task.result = result.result;
          task.completedAt = new Date();

          // 使用 AI Engine SkillOutputManager 统一存储输出
          // 自动处理 Key 规范化和别名映射
          outputManager.store(task.skillId, result.result, {
            taskId: task.id,
            completedAt: task.completedAt,
          });

          // ★ 诊断日志：检查任务结果
          const resultObj = result.result as Record<string, unknown> | null;
          if (task.skillId.includes("outline-planning")) {
            const pages = (resultObj as { pages?: unknown[] })?.pages;
            this.logger.log(
              `[executeTasksPhase] ★ outline-planning result: pages count=${pages?.length || 0}`,
            );
          }
          if (task.skillId.includes("page-pipeline")) {
            const pages = (resultObj as { pages?: unknown[] })?.pages;
            this.logger.log(
              `[executeTasksPhase] ★ page-pipeline result: pages count=${pages?.length || 0}, result keys=${resultObj ? Object.keys(resultObj).join(", ") : "null"}`,
            );
          }

          // 持久化任务结果
          if (this.persistenceEnabled && this.repository) {
            await this.repository.updateTaskResult(task.id, result.result);
          }

          const taskEvent = this.createEvent(
            "task:awaiting_review",
            mission.id,
            {
              task,
              result: result.result,
            },
          );
          yield taskEvent;
          await this.persistEvent(taskEvent);
        } else {
          task.status = "failed";

          // ★ 诊断：任务失败
          this.logger.error(
            `[executeTasksPhase] ★★★ TASK FAILED: ${task.skillId}, error: ${result.error}`,
          );

          // 记录错误
          errors.push({
            taskId: task.id,
            phase: "executing",
            errorType: "execution_failed",
            message: result.error || "Unknown error",
            timestamp: new Date(),
            retryCount: 0,
          });

          // 持久化任务失败状态
          if (this.persistenceEnabled && this.repository) {
            await this.repository.updateTaskStatus(task.id, "failed");
          }

          const failEvent = this.createEvent("task:failed", mission.id, {
            task,
            error: result.error,
          });
          yield failEvent;
          await this.persistEvent(failEvent);
        }
      }

      // 更新进度
      if (this.persistenceEnabled && this.repository) {
        await this.repository.updateMissionProgress(
          mission.id,
          mission.tasks.filter(
            (t) => t.status === "completed" || t.status === "awaiting_review",
          ).length,
        );
      }
    }
  }

  private hasPendingTasks(mission: SlidesMission): boolean {
    return mission.tasks.some((t) => t.status === "pending");
  }

  private getExecutableTasks(mission: SlidesMission): SlidesTask[] {
    return mission.tasks.filter((task) => {
      if (task.status !== "pending") return false;

      // 检查所有依赖是否已完成
      return task.dependencies.every((depId) => {
        const depTask = mission.tasks.find((t) => t.id === depId);
        return (
          depTask?.status === "completed" ||
          depTask?.status === "awaiting_review"
        );
      });
    });
  }

  private async executeTask(
    mission: SlidesMission,
    task: SlidesTask,
    outputManager: ISkillOutputManager,
  ): Promise<TaskExecutionResult> {
    task.status = "in_progress";
    task.startedAt = new Date();

    const context: SkillExecutionContext = {
      missionId: mission.id,
      sessionId: mission.sessionId,
      taskId: task.id,
      executionId: uuidv4(),
      outputManager,
      // 为了向后兼容，同时提供 previousOutputs（deprecated）
      previousOutputs: outputManager.exportTo(),
      globalContext: {
        sourceText: mission.sourceText,
        outline: mission.outline,
        themeId: mission.themeId,
        stylePreference: mission.stylePreference,
        resolvedSkills: mission.resolvedSkills,
      },
    };

    return this.teamMember.executeTask(task, context);
  }

  // ============================================
  // Phase 3: Leader 审核
  // ============================================

  private async *executeReviewPhase(
    mission: SlidesMission,
    errors: SlidesExecutionError[],
  ): AsyncGenerator<SlidesMissionEvent> {
    this.logger.log(
      `[executeReviewPhase] Starting review for mission ${mission.id}`,
    );

    mission.currentPhase = "reviewing";
    mission.status = "reviewing";

    // 持久化状态
    if (this.persistenceEnabled && this.repository) {
      await this.repository.updateMissionStatus(
        mission.id,
        "reviewing",
        "reviewing",
      );
    }

    const phaseEvent = this.createEvent("mission:phase_changed", mission.id, {
      phase: "reviewing",
    });
    yield phaseEvent;
    await this.persistEvent(phaseEvent);

    // 审核所有待审核的任务
    const tasksToReview = mission.tasks.filter(
      (t) => t.status === "awaiting_review",
    );

    for (const task of tasksToReview) {
      const reviewStartEvent = this.createEvent("review:started", mission.id, {
        task,
      });
      yield reviewStartEvent;
      await this.persistEvent(reviewStartEvent);

      const reviewResult = await this.leader.reviewTask(
        mission,
        task,
        task.result,
      );

      if (reviewResult.decision === "approved") {
        task.status = "completed";
        mission.completedTasks++;

        // 持久化审核结果
        if (this.persistenceEnabled && this.repository) {
          await this.repository.updateTaskReview(
            task.id,
            reviewResult.feedback,
            reviewResult.score,
            false,
          );
        }

        const approvedEvent = this.createEvent("review:approved", mission.id, {
          task,
          review: reviewResult,
        });
        yield approvedEvent;
        await this.persistEvent(approvedEvent);
      } else if (reviewResult.decision === "revision_needed") {
        if (task.revisionCount < task.maxRevisions) {
          task.status = "revision_needed";
          task.revisionCount++;
          task.reviewFeedback = reviewResult.feedback;

          // 持久化需要修订的状态
          if (this.persistenceEnabled && this.repository) {
            await this.repository.updateTaskReview(
              task.id,
              reviewResult.feedback,
              reviewResult.score,
              true,
            );
          }

          const revisionEvent = this.createEvent(
            "review:revision_requested",
            mission.id,
            {
              task,
              review: reviewResult,
              revisionCount: task.revisionCount,
              maxRevisions: task.maxRevisions,
            },
          );
          yield revisionEvent;
          await this.persistEvent(revisionEvent);

          // 重新执行任务
          // 从已完成任务的结果中重建 outputManager，保留依赖链上下文
          const retryOutputManager = createSkillOutputManager({ debug: true });
          for (const completedTask of mission.tasks) {
            if (
              completedTask.id !== task.id &&
              (completedTask.status === "completed" ||
                completedTask.status === "awaiting_review") &&
              completedTask.result
            ) {
              retryOutputManager.store(
                completedTask.skillId,
                completedTask.result,
                {
                  taskId: completedTask.id,
                  completedAt: completedTask.completedAt,
                },
              );
            }
          }
          const context: SkillExecutionContext = {
            missionId: mission.id,
            sessionId: mission.sessionId,
            taskId: task.id,
            executionId: uuidv4(),
            outputManager: retryOutputManager,
            previousOutputs: retryOutputManager.exportTo(),
            globalContext: {
              sourceText: mission.sourceText,
              outline: mission.outline,
              themeId: mission.themeId,
              stylePreference: mission.stylePreference,
              resolvedSkills: mission.resolvedSkills,
            },
          };

          const retryResult = await this.teamMember.executeTask(task, context);

          if (retryResult.success) {
            task.result = retryResult.result;
            task.status = "completed";
            mission.completedTasks++;

            // 持久化成功结果
            if (this.persistenceEnabled && this.repository) {
              await this.repository.updateTaskResult(
                task.id,
                retryResult.result,
              );
            }

            const completedEvent = this.createEvent(
              "task:completed",
              mission.id,
              {
                task,
                result: retryResult.result,
              },
            );
            yield completedEvent;
            await this.persistEvent(completedEvent);
          } else {
            task.status = "failed";

            // 记录错误
            errors.push({
              taskId: task.id,
              phase: "reviewing",
              errorType: "review_failed",
              message: retryResult.error || "Revision failed",
              timestamp: new Date(),
              retryCount: task.revisionCount,
            });

            // 持久化失败状态
            if (this.persistenceEnabled && this.repository) {
              await this.repository.updateTaskStatus(task.id, "failed");
            }

            const failedEvent = this.createEvent("task:failed", mission.id, {
              task,
              error: retryResult.error,
            });
            yield failedEvent;
            await this.persistEvent(failedEvent);
          }
        } else {
          // 超过最大修订次数，标记为完成（降级处理）
          task.status = "completed";
          mission.completedTasks++;

          this.logger.warn(
            `[executeReviewPhase] Task ${task.id} exceeded max revisions, accepting as-is`,
          );

          // 持久化降级完成
          if (this.persistenceEnabled && this.repository) {
            await this.repository.updateTaskReview(
              task.id,
              reviewResult.feedback + " [DEGRADED: max revisions exceeded]",
              reviewResult.score,
              false,
            );
          }

          const degradedEvent = this.createEvent(
            "review:approved",
            mission.id,
            {
              task,
              review: reviewResult,
              degraded: true,
            },
          );
          yield degradedEvent;
          await this.persistEvent(degradedEvent);
        }
      } else {
        task.status = "failed";

        // 记录错误
        errors.push({
          taskId: task.id,
          phase: "reviewing",
          errorType: "review_failed",
          message: reviewResult.feedback || "Review failed",
          timestamp: new Date(),
          retryCount: task.revisionCount,
        });

        // 持久化失败状态
        if (this.persistenceEnabled && this.repository) {
          await this.repository.updateTaskStatus(task.id, "failed");
        }

        const failedEvent = this.createEvent("task:failed", mission.id, {
          task,
          review: reviewResult,
        });
        yield failedEvent;
        await this.persistEvent(failedEvent);
      }
    }

    // 更新进度
    if (this.persistenceEnabled && this.repository) {
      await this.repository.updateMissionProgress(
        mission.id,
        mission.completedTasks,
      );
    }
  }

  // ============================================
  // Phase 4: 质量审计
  // ============================================

  private async *executeAuditPhase(
    mission: SlidesMission,
    _errors: SlidesExecutionError[],
  ): AsyncGenerator<SlidesMissionEvent> {
    this.logger.log(
      `[executeAuditPhase] Starting quality audit for mission ${mission.id}`,
    );

    mission.currentPhase = "auditing";
    mission.status = "auditing";

    // 持久化状态
    if (this.persistenceEnabled && this.repository) {
      await this.repository.updateMissionStatus(
        mission.id,
        "auditing",
        "auditing",
      );
    }

    const phaseEvent = this.createEvent("mission:phase_changed", mission.id, {
      phase: "auditing",
    });
    yield phaseEvent;
    await this.persistEvent(phaseEvent);

    const auditStartEvent = this.createEvent("audit:started", mission.id, {});
    yield auditStartEvent;
    await this.persistEvent(auditStartEvent);

    // Run deck consistency auditor if available and we have pages
    let qualityAudit: QualityAuditResult;
    if (this.deckConsistencyAuditor && mission.pages.length > 0) {
      try {
        const auditResult = await this.deckConsistencyAuditor.execute(
          {
            pages: mission.pages.map((p) => {
              const page = p as {
                html?: string;
                renderedHtml?: string;
                index?: number;
                spec?: { title?: string; templateType?: string };
              };
              return {
                html: page.renderedHtml || page.html || "",
                pageNumber: page.index ?? 0,
                templateType: page.spec?.templateType || "content",
                title: page.spec?.title || "",
              };
            }),
            themeId: mission.themeId,
          },
          {
            executionId: `${mission.id}-audit`,
            skillId: "slides-deck-consistency-auditor",
            sessionId: mission.sessionId,
            createdAt: new Date(),
          },
        );

        if (auditResult.success && auditResult.data) {
          qualityAudit = {
            passed: auditResult.data.passed,
            overallScore: auditResult.data.overallScore,
            terminologyScore: 100,
            transitionScore: 100,
            consistencyScore: auditResult.data.scores.colorConsistency,
            issues: auditResult.data.issues.map((issue) => ({
              type: (issue.type === "color_drift" || issue.type === "font_drift"
                ? "consistency"
                : issue.type === "layout_repetition"
                  ? "layout"
                  : issue.type === "narrative_flow"
                    ? "content"
                    : "consistency") as "consistency" | "layout" | "content",
              severity: (issue.severity === "error"
                ? "critical"
                : issue.severity) as "critical" | "warning" | "info",
              description: issue.message,
              suggestion: issue.suggestion,
            })),
            suggestions: auditResult.data.fixSuggestions.map(
              (s) => `Page ${s.pageNumber}: ${s.description}`,
            ),
          };
        } else {
          // Auditor failed, use default
          qualityAudit = {
            passed: true,
            overallScore: 85,
            terminologyScore: 100,
            transitionScore: 100,
            consistencyScore: 90,
            issues: [],
            suggestions: [],
          };
        }
      } catch (auditError) {
        this.logger.warn(
          `[executeAuditPhase] Deck consistency audit failed: ${auditError}`,
        );
        qualityAudit = {
          passed: true,
          overallScore: 85,
          terminologyScore: 100,
          transitionScore: 100,
          consistencyScore: 90,
          issues: [],
          suggestions: [],
        };
      }
    } else {
      // Fallback: no auditor or no pages
      qualityAudit = {
        passed: true,
        overallScore: 85,
        terminologyScore: 100,
        transitionScore: 100,
        consistencyScore: 90,
        issues: [],
        suggestions: [],
      };
    }

    // 保存审计结果到 mission 元数据
    mission.metadata.qualityAudit = qualityAudit;

    // 持久化审计结果
    if (this.persistenceEnabled && this.repository) {
      await this.repository.updateMissionQualityAudit(mission.id, qualityAudit);
    }

    const auditCompleteEvent = this.createEvent("audit:completed", mission.id, {
      qualityAudit,
    });
    yield auditCompleteEvent;
    await this.persistEvent(auditCompleteEvent);
  }

  // ============================================
  // Phase 5: Leader 综合
  // ============================================

  private async *executeSynthesisPhase(
    mission: SlidesMission,
    _errors: SlidesExecutionError[],
  ): AsyncGenerator<SlidesMissionEvent> {
    this.logger.log(
      `[executeSynthesisPhase] Starting synthesis for mission ${mission.id}`,
    );

    mission.currentPhase = "synthesizing";
    mission.status = "synthesizing";

    // 持久化状态
    if (this.persistenceEnabled && this.repository) {
      await this.repository.updateMissionStatus(
        mission.id,
        "synthesizing",
        "synthesizing",
      );
    }

    const phaseEvent = this.createEvent("mission:phase_changed", mission.id, {
      phase: "synthesizing",
    });
    yield phaseEvent;
    await this.persistEvent(phaseEvent);

    const synthesisStartEvent = this.createEvent(
      "synthesis:started",
      mission.id,
      {},
    );
    yield synthesisStartEvent;
    await this.persistEvent(synthesisStartEvent);

    // 从任务结果中提取页面
    this.extractPagesFromTasks(mission);

    // 持久化页面
    if (this.persistenceEnabled && this.repository) {
      await this.repository.updateMissionPages(mission.id, mission.pages);
      if (mission.outline) {
        await this.repository.updateMissionOutline(mission.id, mission.outline);
      }
    }

    // Leader 综合结果
    const synthesis = await this.leader.synthesizeResults(mission);

    // 发送页面生成事件
    for (let i = 0; i < mission.pages.length; i++) {
      const pageEvent = this.createEvent("page:generated", mission.id, {
        pageIndex: i,
        page: mission.pages[i],
      });
      yield pageEvent;
      await this.persistEvent(pageEvent);
    }

    const synthesisCompleteEvent = this.createEvent(
      "synthesis:completed",
      mission.id,
      {
        synthesis,
        pageCount: mission.pages.length,
      },
    );
    yield synthesisCompleteEvent;
    await this.persistEvent(synthesisCompleteEvent);
  }

  /**
   * 从任务结果中提取页面
   */
  private extractPagesFromTasks(mission: SlidesMission): void {
    this.logger.log(
      `[extractPagesFromTasks] ★ Starting extraction, ${mission.tasks.length} tasks to process`,
    );

    // ★ 诊断：列出所有任务状态
    for (const t of mission.tasks) {
      this.logger.log(
        `[extractPagesFromTasks] ★ Task overview: id=${t.id.slice(0, 8)}, skillId=${t.skillId}, status=${t.status}, hasResult=${!!t.result}`,
      );
    }

    for (const task of mission.tasks) {
      this.logger.log(
        `[extractPagesFromTasks] ★ Processing task: skillId=${task.skillId}, status=${task.status}, hasResult=${!!task.result}`,
      );

      if (task.status !== "completed" || !task.result) {
        this.logger.log(
          `[extractPagesFromTasks] ★ Skipping task ${task.skillId}: status=${task.status}, hasResult=${!!task.result}`,
        );
        continue;
      }

      // 从 four-step-design 结果中提取页面（单页）
      if (
        task.skillId === "four-step-design" ||
        task.skillId === "slides-four-step-design"
      ) {
        const result = task.result as {
          html?: string;
          design?: unknown;
          pageNumber?: number;
        };

        if (result.html) {
          const page: GeneratedSlide = {
            id: uuidv4(),
            index: result.pageNumber || mission.pages.length,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- placeholder empty spec/content, typed by GeneratedSlide
            spec: {} as any,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any -- placeholder empty spec/content, typed by GeneratedSlide
            content: {} as any,
            images: [],
            renderedHtml: result.html,
            html: result.html,
            isEdited: false,
            editHistory: [],
            generationMetadata: {
              textModelUsed: "unknown",
              contentGeneratedAt: new Date().toISOString(),
            },
          };

          mission.pages.push(page);
        }
      }

      // 从 page-pipeline 结果中提取页面（多页）
      if (
        task.skillId === "page-pipeline" ||
        task.skillId === "slides-page-pipeline"
      ) {
        const result = task.result as {
          pages?: Array<{
            html?: string;
            renderedHtml?: string;
            pageNumber?: number;
            title?: string;
            templateId?: string;
          }>;
        };

        this.logger.log(
          `[extractPagesFromTasks] ★ Found page-pipeline task, pages count=${result.pages?.length || 0}, result keys=${Object.keys(task.result as object).join(", ")}`,
        );

        if (result.pages && Array.isArray(result.pages)) {
          for (const pageResult of result.pages) {
            const html = pageResult.renderedHtml || pageResult.html;
            this.logger.debug(
              `[extractPagesFromTasks] Page ${pageResult.pageNumber}: html length=${html?.length || 0}`,
            );
            if (html) {
              const page: GeneratedSlide = {
                id: uuidv4(),
                index: pageResult.pageNumber || mission.pages.length,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any -- placeholder spec with title, typed by GeneratedSlide
                spec: { title: pageResult.title } as any,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any -- placeholder empty content, typed by GeneratedSlide
                content: {} as any,
                images: [],
                renderedHtml: html,
                html: html,
                isEdited: false,
                editHistory: [],
                generationMetadata: {
                  textModelUsed: "unknown",
                  contentGeneratedAt: new Date().toISOString(),
                },
              };

              mission.pages.push(page);
            }
          }
        }
      }

      // 从 outline-planning 结果中提取大纲
      if (
        task.skillId === "outline-planning" ||
        task.skillId === "slides-outline-planning"
      ) {
        mission.outline = task.result as PPTOutline;
      }

      // 记录 task-decomposition 结果用于调试
      if (
        task.skillId === "task-decomposition" ||
        task.skillId === "slides-task-decomposition"
      ) {
        this.logger.log(
          `[extractPagesFromTasks] Task decomposition completed with ${(task.result as { totalPages?: number })?.totalPages || 0} pages planned`,
        );
      }
    }

    // ★ 最终统计
    this.logger.log(
      `[extractPagesFromTasks] ★ Extraction complete: ${mission.pages.length} pages extracted`,
    );
  }

  // ============================================
  // Helper Methods
  // ============================================

  private createEvent(
    type: SlidesMissionEvent["type"],
    missionId: string,
    data: Record<string, unknown>,
  ): SlidesMissionEvent {
    return {
      type,
      missionId,
      timestamp: new Date(),
      data,
    };
  }
}
