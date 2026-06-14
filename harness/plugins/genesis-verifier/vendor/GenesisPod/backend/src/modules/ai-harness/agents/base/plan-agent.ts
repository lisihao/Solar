/**
 * Legacy Plan Agent (migrated from ai-harness/agents/base)
 *
 * @deprecated Use HarnessedAgent / SpecBasedAgent for new agents.
 * Migrated: PR-X5 (ai-harness/agents/base → ai-harness/agents/base)
 */

import { ExecutionMode } from "@/modules/ai-harness/agents/abstractions/agent.types";
import { AgentError } from "@/modules/ai-harness/agents/abstractions/agent-error";
import {
  AgentContext,
  AgentInput,
  AgentOutput,
  AgentEvent,
  AgentResult,
  ExecutionPlan,
  ReActPlanStep,
} from "../abstractions/plan-based-agent.interface";
import { BaseAgent } from "./base-agent";

/**
 * Plan Agent 配置
 */
export interface PlanAgentConfig {
  /**
   * 是否允许重新规划
   */
  allowReplan?: boolean;

  /**
   * 最大重新规划次数
   */
  maxReplans?: number;

  /**
   * 步骤失败时的策略
   */
  onStepFailure?: "abort" | "skip" | "replan";

  /**
   * 是否启用检查点
   */
  enableCheckpoints?: boolean;
}

/**
 * 步骤执行结果
 */
export interface StepResult {
  stepId: string;
  success: boolean;
  output?: unknown;
  error?: string;
  duration: number;
}

/**
 * Plan-Based 模式 Agent 基类
 * 先规划后执行
 */
export abstract class PlanAgent<
  TInput = AgentInput,
  TOutput = AgentOutput,
> extends BaseAgent<TInput, TOutput> {
  /**
   * 支持的执行模式
   */
  readonly supportedModes: ExecutionMode[] = ["plan-based"];

  /**
   * 配置
   */
  protected config: PlanAgentConfig;

  /**
   * 默认配置
   */
  private static readonly DEFAULT_CONFIG: PlanAgentConfig = {
    allowReplan: true,
    maxReplans: 3,
    onStepFailure: "replan",
    enableCheckpoints: true,
  };

  constructor(config?: Partial<PlanAgentConfig>) {
    super();
    this.config = { ...PlanAgent.DEFAULT_CONFIG, ...config };
  }

  /**
   * 生成执行计划（子类必须实现）
   */
  abstract plan(input: TInput, context: AgentContext): Promise<ExecutionPlan>;

  /**
   * 处理执行结果（子类必须实现）
   */
  protected abstract processResults(
    results: StepResult[],
    context: AgentContext,
  ): Promise<TOutput>;

  /**
   * 核心执行逻辑
   */
  protected async doExecute(
    input: TInput,
    context: AgentContext,
  ): Promise<TOutput> {
    let replanCount = 0;
    let currentPlan = await this.plan(input, context);
    const allResults: StepResult[] = [];

    while (replanCount <= (this.config.maxReplans || 3)) {
      // 检查取消信号
      if (context.signal?.aborted) {
        throw AgentError.cancelled(this.id);
      }

      // 执行计划
      const { results, needReplan, failedStep } = await this.executePlan(
        currentPlan,
        context,
      );
      allResults.push(...results);

      if (!needReplan) {
        // 执行成功，处理结果
        return this.processResults(allResults, context);
      }

      // 需要重新规划
      if (!this.config.allowReplan) {
        throw AgentError.executionFailed(
          this.id,
          `Step ${failedStep} failed and replan is disabled`,
        );
      }

      replanCount++;
      this.logger.warn(
        `[${this.id}] Replanning (attempt ${replanCount}/${this.config.maxReplans})`,
      );

      // 重新生成计划
      currentPlan = await this.replan(
        input,
        context,
        currentPlan,
        failedStep || "",
        allResults,
      );
    }

    throw AgentError.executionFailed(
      this.id,
      `Exceeded max replan attempts (${this.config.maxReplans})`,
    );
  }

  /**
   * 流式执行
   */
  async *executeStream(
    input: TInput,
    context: AgentContext,
  ): AsyncGenerator<AgentEvent, AgentResult<TOutput>> {
    const startTime = new Date();
    const executionId = context.executionId || "";
    let replanCount = 0;

    // 发送开始事件
    yield {
      type: "started",
      agentId: this.id,
      executionId,
      timestamp: new Date(),
    };

    try {
      // 生成计划
      yield {
        type: "thinking",
        agentId: this.id,
        executionId,
        timestamp: new Date(),
        data: { phase: "planning" },
      };

      let currentPlan = await this.plan(input, context);
      const allResults: StepResult[] = [];

      while (replanCount <= (this.config.maxReplans || 3)) {
        if (context.signal?.aborted) {
          throw AgentError.cancelled(this.id);
        }

        // 执行每个步骤
        for (const step of currentPlan.steps) {
          yield {
            type: "thinking",
            agentId: this.id,
            executionId,
            timestamp: new Date(),
            data: {
              phase: "executing",
              step: step.id,
              description: step.description,
            },
          };

          const result = await this.executeStep(step, context);
          allResults.push(result);

          if (result.success) {
            yield {
              type: step.type === "tool" ? "tool_result" : "skill_result",
              agentId: this.id,
              executionId,
              timestamp: new Date(),
              data: {
                stepId: step.id,
                output: result.output,
              },
            };
          } else {
            // 步骤失败
            if (this.config.onStepFailure === "abort") {
              throw AgentError.executionFailed(
                this.id,
                `Step ${step.id} failed: ${result.error}`,
              );
            }

            if (this.config.onStepFailure === "replan") {
              replanCount++;
              if (replanCount > (this.config.maxReplans || 3)) {
                throw AgentError.executionFailed(
                  this.id,
                  `Exceeded max replan attempts`,
                );
              }

              currentPlan = await this.replan(
                input,
                context,
                currentPlan,
                step.id,
                allResults,
              );
              break;
            }
            // skip: 继续执行下一步
          }
        }

        // 所有步骤执行完成
        const output = await this.processResults(allResults, context);

        const result: AgentResult<TOutput> = {
          success: true,
          data: output,
          metadata: {
            executionId,
            startTime,
            endTime: new Date(),
            duration: Date.now() - startTime.getTime(),
          },
        };

        yield {
          type: "completed",
          agentId: this.id,
          executionId,
          timestamp: new Date(),
          data: result,
        };

        return result;
      }

      throw AgentError.executionFailed(this.id, `Exceeded max replan attempts`);
    } catch (error) {
      const agentError = AgentError.fromError(error, this.id);

      yield {
        type: "error",
        agentId: this.id,
        executionId,
        timestamp: new Date(),
        data: { error: agentError.message },
      };

      return {
        success: false,
        error: {
          code: agentError.code,
          message: agentError.message,
          retryable: agentError.retryable,
        },
        metadata: {
          executionId,
          startTime,
          endTime: new Date(),
          duration: Date.now() - startTime.getTime(),
        },
      };
    }
  }

  /**
   * 执行计划
   */
  private async executePlan(
    plan: ExecutionPlan,
    context: AgentContext,
  ): Promise<{
    results: StepResult[];
    needReplan: boolean;
    failedStep?: string;
  }> {
    const results: StepResult[] = [];

    for (const step of plan.steps) {
      // 检查依赖
      if (step.dependsOn) {
        const unmetDeps = step.dependsOn.filter(
          (depId) => !results.some((r) => r.stepId === depId && r.success),
        );
        if (unmetDeps.length > 0) {
          this.logger.warn(
            `[${this.id}] Skipping step ${step.id} due to unmet dependencies`,
          );
          continue;
        }
      }

      const result = await this.executeStep(step, context);
      results.push(result);

      if (!result.success) {
        if (this.config.onStepFailure === "abort") {
          return { results, needReplan: false, failedStep: step.id };
        }
        if (this.config.onStepFailure === "replan") {
          return { results, needReplan: true, failedStep: step.id };
        }
        // skip: 继续执行
      }
    }

    return { results, needReplan: false };
  }

  /**
   * 执行单个步骤
   */
  private async executeStep(
    step: ReActPlanStep,
    context: AgentContext,
  ): Promise<StepResult> {
    const startTime = Date.now();

    try {
      let output: unknown;

      switch (step.type) {
        case "tool":
          const toolResult = await this.callTool(
            step.executor,
            step.input,
            context,
          );
          output = toolResult.data;
          break;

        case "skill":
          const skillResult = await this.callSkill(
            step.executor,
            step.input,
            context,
          );
          output = skillResult.data;
          break;

        case "agent":
          // TODO: 支持调用其他 Agent
          throw new Error("Agent step not implemented");

        case "decision":
          // 决策步骤由子类实现
          output = await this.executeDecision(step, context);
          break;

        case "wait":
          await this.wait(step.input as number);
          output = { waited: step.input };
          break;

        case "parallel":
          // 并行执行子步骤
          output = await this.executeParallel(step, context);
          break;

        default:
          throw new Error(`Unknown step type: ${step.type}`);
      }

      return {
        stepId: step.id,
        success: true,
        output,
        duration: Date.now() - startTime,
      };
    } catch (error) {
      return {
        stepId: step.id,
        success: false,
        error: (error as Error).message,
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * 重新规划
   */
  protected async replan(
    input: TInput,
    context: AgentContext,
    _currentPlan: ExecutionPlan,
    _failedStep: string,
    _results: StepResult[],
  ): Promise<ExecutionPlan> {
    // 默认实现：重新生成完整计划
    // 子类可以覆盖以实现增量规划
    return this.plan(input, context);
  }

  /**
   * 执行决策步骤
   */
  protected async executeDecision(
    step: ReActPlanStep,
    _context: AgentContext,
  ): Promise<unknown> {
    // 默认实现：返回条件评估结果
    // 子类可以覆盖以实现复杂决策
    return { decision: step.condition };
  }

  /**
   * 并行执行子步骤（每批最多 3 个并发，Promise.allSettled 保证部分失败不中断整体）
   */
  private async executeParallel(
    step: ReActPlanStep,
    context: AgentContext,
  ): Promise<unknown[]> {
    const subSteps = step.input as ReActPlanStep[] | undefined;

    if (!Array.isArray(subSteps) || subSteps.length === 0) {
      this.logger.warn(
        `[executeParallel] Step ${step.id}: no substeps in input, returning []`,
      );
      return [];
    }

    if (context.signal?.aborted) {
      throw new Error(
        `[executeParallel] Execution cancelled before step ${step.id}`,
      );
    }

    const CONCURRENCY = 3;
    const results: unknown[] = [];

    for (let i = 0; i < subSteps.length; i += CONCURRENCY) {
      if (context.signal?.aborted) break;

      const batch = subSteps.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.allSettled(
        batch.map((subStep) => this.executeStep(subStep, context)),
      );

      for (const settled of batchResults) {
        if (settled.status === "fulfilled" && settled.value.success) {
          results.push(settled.value.output ?? null);
        } else if (settled.status === "fulfilled" && !settled.value.success) {
          this.logger.warn(
            `[executeParallel] Sub-step ${settled.value.stepId} failed: ${settled.value.error}`,
          );
          results.push(null);
        } else {
          this.logger.warn(
            `[executeParallel] Sub-step rejected unexpectedly: ${String((settled as PromiseRejectedResult).reason)}`,
          );
          results.push(null);
        }
      }
    }

    this.logger.log(
      `[executeParallel] Step ${step.id}: ${subSteps.length} substeps → ${results.filter((r) => r !== null).length} succeeded`,
    );

    return results;
  }

  /**
   * 等待
   */
  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
