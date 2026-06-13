/**
 * SOTA Runtime · ReActRunner
 *
 * 方案文档 §4.2 / §0.3。通用 Observe→Think→Plan→Act→Reflect→SelfEval 循环。
 *
 * 归属：@/modules/ai-harness/runner/env/ — 通用，任何 AI App 复用
 *
 * 架构硬约束（方案 §0.1）：
 *   - 不 import @prisma/client 业务 model
 *   - 不 import ai-app/**
 *   - 所有持久化通过 StepStore / CheckpointStore / VerificationStore / TaskStore 接口
 *   - 业务字段走 AgentTask.metadata 泛型
 */

import { Injectable, Logger } from "@nestjs/common";
import { BudgetAccountant } from "@/modules/ai-harness/guardrails/budget/budget-accountant";
import {
  AgentToolSchemaRegistry,
  type ToolExecContext,
} from "../env/agent-tool-schema-registry";
import { AgentTracer, type Span } from "../../tracing/tracer/otel-tracer";
import type {
  StepStore,
  CheckpointStore,
  VerificationStore,
  TaskStore,
} from "./runner-stores.interface";
import {
  HumanInLoopPause,
  type AgentAction,
  type AgentStepType,
  type AgentStepRecord,
  type AgentTask,
  type ConsensusDecision,
  type Message,
  type Observation,
  type Scratchpad,
  type TokenBudget,
  type ToolInvocation,
  type ToolResult,
  type Verdict,
} from "../env/types";

/**
 * LLM 调用抽象（具体实现由 App 层 protocol 注入）
 */
export interface LLMCaller {
  call(req: {
    messages: Message[];
    tools?: ReturnType<AgentToolSchemaRegistry["getSchemas"]>;
    modelTier: "strong" | "standard" | "basic";
    span: Span;
  }): Promise<{
    content: string;
    toolCalls?: Array<{
      name: string;
      args: Record<string, unknown>;
      id: string;
    }>;
    promptTokens: number;
    completionTokens: number;
    costUsd: number;
    modelId: string;
  }>;
}

/**
 * Judge 抽象（Phase 4 实现 Self/External/Meta）
 */
export interface JudgeSpec<TResult = unknown> {
  readonly judgeId: string;
  evaluate(
    draft: TResult,
    task: AgentTask,
    ctx: ReActExecutionContext,
  ): Promise<Omit<Verdict, "judgeId">>;
}

/**
 * Consensus 决策函数（Phase 4 实现）
 */
export type ConsensusResolver = (
  verdicts: readonly Verdict[],
) => ConsensusDecision;

/**
 * TaskExecutionProtocol — 某 taskType 的 ReAct 配置
 *
 * 归属：接口在 harness；具体 protocol 实现在 app 层。
 */
export interface TaskExecutionProtocol<
  TResult,
  TMetadata extends Record<string, unknown> = Record<string, unknown>,
> {
  readonly taskType: string;
  readonly maxIterations: number;
  /** 0-100 self-eval score */
  readonly convergenceThreshold: number;
  readonly budgetCap: TokenBudget;
  readonly allowedTools: readonly string[];
  readonly judges: readonly JudgeSpec<TResult>[];

  buildInitialMessages(task: AgentTask<TMetadata>): Promise<Message[]>;

  parseAction(llmOut: {
    content: string;
    toolCalls?: Array<{
      name: string;
      args: Record<string, unknown>;
      id: string;
    }>;
  }): AgentAction;

  assembleResult(
    task: AgentTask<TMetadata>,
    history: ReActHistory,
  ): Promise<TResult>;

  /** 可选 self-eval override；默认 runner 用启发式算法 */
  selfEvaluate?(
    task: AgentTask<TMetadata>,
    history: ReActHistory,
  ): Promise<number>;
}

export interface ReActHistory {
  readonly observations: readonly Observation[];
  readonly scratchpad: Scratchpad;
  readonly toolInvocations: readonly ToolInvocation[];
  readonly stepCount: number;
}

export interface ReActExecutionContext<
  TMetadata extends Record<string, unknown> = Record<string, unknown>,
> {
  readonly task: AgentTask<TMetadata>;
  readonly budget: BudgetAccountant;
  readonly toolRegistry: AgentToolSchemaRegistry;
  readonly llm: LLMCaller;
  readonly tracer: AgentTracer;
  readonly span: Span;
  readonly messages: Message[];
  readonly observations: Observation[];
  readonly scratchpad: Scratchpad;
  readonly toolInvocations: ToolInvocation[];
}

export interface ReActStores<TMetadata extends Record<string, unknown>> {
  readonly stepStore: StepStore;
  readonly checkpointStore: CheckpointStore;
  readonly verificationStore: VerificationStore;
  readonly taskStore: TaskStore<TMetadata>;
}

@Injectable()
export class ReActRunner {
  private readonly logger = new Logger(ReActRunner.name);

  constructor(
    private readonly tracer: AgentTracer,
    private readonly toolRegistry: AgentToolSchemaRegistry,
  ) {}

  async execute<
    TResult,
    TMetadata extends Record<string, unknown> = Record<string, unknown>,
  >(
    task: AgentTask<TMetadata>,
    protocol: TaskExecutionProtocol<TResult, TMetadata>,
    llm: LLMCaller,
    consensus: ConsensusResolver,
    stores: ReActStores<TMetadata>,
  ): Promise<TResult | null> {
    const budget = new BudgetAccountant(protocol.budgetCap);

    // Resume from checkpoint if any
    const resume = await stores.checkpointStore.loadLatest(task.id);
    const observations: Observation[] = [...(resume?.observations ?? [])];
    const scratchpad: Scratchpad = (resume?.reasoningMemory as Scratchpad) ?? {
      notes: [],
      keyFindings: [],
      pendingQuestions: [],
    };
    const toolInvocations: ToolInvocation[] = [
      ...(resume?.toolInvocationHistory ?? []),
    ];
    if (resume?.budgetSnapshot) budget.restore(resume.budgetSnapshot);
    let iteration = resume?.iteration ?? task.currentIteration;

    const taskSpan = this.tracer.startSpan(`task.${task.type}`, {
      attributes: { taskId: task.id, taskType: task.type, resumed: !!resume },
    });

    await stores.taskStore.updateStatus(task.id, "RUNNING", {
      startedAt: new Date(),
    });

    const initialMessages = await protocol.buildInitialMessages(task);
    const messages: Message[] = [...initialMessages];

    try {
      let converged = false;
      while (!converged && iteration < protocol.maxIterations) {
        const iterSpan = this.tracer.startSpan(`react.iter.${iteration}`, {
          parent: taskSpan,
          attributes: { iteration },
        });

        // 1. Observe
        const latestObs: Observation =
          observations.length > 0
            ? observations[observations.length - 1]
            : {
                source: "initial",
                data: task.description,
                timestamp: Date.now(),
              };
        await this.recordStep(
          stores.stepStore,
          task,
          iteration,
          "OBSERVE",
          latestObs,
          iterSpan,
        );

        // 2. Think
        const thought = await llm.call({
          messages,
          tools: this.toolRegistry.getSchemas(protocol.allowedTools),
          modelTier: budget.getCurrentTier(),
          span: iterSpan,
        });
        budget.accountLLM(
          thought.promptTokens,
          thought.completionTokens,
          thought.costUsd,
        );
        await this.recordStep(
          stores.stepStore,
          task,
          iteration,
          "THINK",
          thought.content,
          iterSpan,
          {
            modelId: thought.modelId,
            promptTokens: thought.promptTokens,
            completionTokens: thought.completionTokens,
            costUsd: thought.costUsd,
          },
        );
        messages.push({
          role: "assistant",
          content: thought.content,
          toolCalls: thought.toolCalls,
        });

        // 3. Plan
        const action = protocol.parseAction(thought);
        await this.recordStep(
          stores.stepStore,
          task,
          iteration,
          "PLAN",
          action,
          iterSpan,
        );

        // 4. Act
        if (action.kind === "done") {
          converged = true;
          iterSpan.end({ outcome: "done" });
          break;
        }
        if (action.kind === "need_human") {
          await stores.taskStore.updateStatus(task.id, "AWAITING_HUMAN", {
            pausedAt: new Date(),
          });
          iterSpan.end({ outcome: "need_human" });
          throw new HumanInLoopPause(task.id, action);
        }
        if (action.kind === "abort") {
          await stores.taskStore.updateStatus(task.id, "FAILED", {
            completedAt: new Date(),
            resultSummary: `abort: ${action.reason}`,
          });
          iterSpan.end({ outcome: "abort" });
          return null;
        }
        if (action.kind === "tool_call") {
          const toolCtx: ToolExecContext = {
            taskId: task.id,
            scope: this.extractScope(task.metadata),
            traceId: iterSpan.traceId,
            spanId: iterSpan.spanId,
            callCount: toolInvocations.filter((t) => t.tool === action.tool)
              .length,
          };
          const toolResult: ToolResult = await this.toolRegistry.execute(
            action.tool,
            action.args,
            toolCtx,
          );
          if (toolResult.costUsd) budget.accountTool(toolResult.costUsd);
          await this.recordStep(
            stores.stepStore,
            task,
            iteration,
            "TOOL_CALL",
            action,
            iterSpan,
            { toolName: action.tool, toolArgs: action.args },
          );
          await this.recordStep(
            stores.stepStore,
            task,
            iteration,
            "TOOL_RESULT",
            toolResult,
            iterSpan,
            {
              toolName: action.tool,
              toolLatencyMs: toolResult.latencyMs,
              toolSuccess: toolResult.success,
              toolResult: toolResult.data,
            },
          );
          observations.push({
            source: action.tool,
            data: toolResult,
            timestamp: Date.now(),
          });
          toolInvocations.push({
            tool: action.tool,
            args: action.args,
            result: toolResult,
            iteration,
            stepIndex: 0,
          });
          messages.push({
            role: "tool",
            toolCallId:
              thought.toolCalls?.[0]?.id ?? action.toolCallId ?? "unknown",
            content: JSON.stringify(toolResult.data ?? toolResult.error ?? {}),
          });
        }

        // 5. Self-evaluate
        const history: ReActHistory = {
          observations,
          scratchpad,
          toolInvocations,
          stepCount: iteration + 1,
        };
        const selfScore = protocol.selfEvaluate
          ? await protocol.selfEvaluate(task, history)
          : this.defaultSelfEvaluate(history);
        await this.recordStep(
          stores.stepStore,
          task,
          iteration,
          "SELF_EVAL",
          {
            score: selfScore,
            reason: `steps=${iteration + 1} tools=${toolInvocations.length}`,
          },
          iterSpan,
        );
        if (selfScore >= protocol.convergenceThreshold) {
          converged = true;
        }

        // 6. Budget guard
        if (budget.exhausted()) {
          this.logger.warn(
            `[${task.id}] budget exhausted iter=${iteration} tier=${budget.getCurrentTier()}`,
          );
          iterSpan.end({ outcome: "budget_exhausted" });
          break;
        }
        if (budget.shouldDowngrade() && budget.canDowngrade()) {
          const newTier = budget.downgrade();
          this.logger.log(`[${task.id}] budget downgrade → ${newTier}`);
        }

        // 7. Checkpoint
        const checkpointId = await stores.checkpointStore.save(
          task.id,
          {
            iteration,
            stepIndex: 0,
            observations,
            reasoningMemory: scratchpad,
            toolInvocationHistory: toolInvocations,
            budgetSnapshot: budget.snapshot(),
          },
          "RUNNING",
          task.metadata,
        );

        iteration++;
        await stores.taskStore.updateProgress(task.id, {
          currentIteration: iteration,
          tokensUsed: budget.snapshot().tokensUsed,
          costUsd: budget.snapshot().costUsd,
          lastCheckpointId: checkpointId,
        });
        iterSpan.end({ outcome: converged ? "converged" : "continue" });
      }

      // Assemble draft
      const history: ReActHistory = {
        observations,
        scratchpad,
        toolInvocations,
        stepCount: iteration,
      };
      const draft = await protocol.assembleResult(task, history);

      // Verify
      await stores.taskStore.updateStatus(task.id, "VERIFYING");
      const verdicts: Verdict[] = [];
      for (const judge of protocol.judges) {
        try {
          const v = await judge.evaluate(draft, task, {
            task,
            budget,
            toolRegistry: this.toolRegistry,
            llm,
            tracer: this.tracer,
            span: taskSpan,
            messages,
            observations,
            scratchpad,
            toolInvocations,
          });
          verdicts.push({ judgeId: judge.judgeId, ...v });
          await this.recordStep(
            stores.stepStore,
            task,
            iteration,
            "JUDGE_EVAL",
            {
              judgeId: judge.judgeId,
              score: v.score,
              critique: v.critique.slice(0, 500),
            },
            taskSpan,
          );
        } catch (err) {
          this.logger.warn(
            `[${task.id}] judge=${judge.judgeId} failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      const decision: ConsensusDecision =
        verdicts.length > 0
          ? consensus(verdicts)
          : {
              verdict: "pass",
              score: 70,
              note: "no judges available, default pass",
            };

      await stores.verificationStore.write(
        { taskId: task.id, iteration, verdicts, decision },
        task.metadata,
      );

      if (decision.verdict === "escalate_to_human") {
        await stores.taskStore.updateStatus(task.id, "AWAITING_HUMAN", {
          pausedAt: new Date(),
        });
        return null;
      }
      if (decision.verdict === "fail") {
        if (task.retryCount < task.maxRetries) {
          await stores.taskStore.markForRetry(task.id);
          return null;
        }
        await stores.taskStore.updateStatus(task.id, "FAILED", {
          completedAt: new Date(),
          resultSummary: `judge fail after ${task.retryCount} retries`,
        });
        return null;
      }

      // COMPLETED
      await stores.taskStore.writeResult(task.id, {
        result: draft,
        resultScore: decision.score,
        resultSummary: this.summarize(draft),
      });
      await stores.taskStore.updateStatus(task.id, "COMPLETED", {
        completedAt: new Date(),
      });
      await stores.checkpointStore.clear(task.id);

      return draft;
    } catch (err) {
      if (err instanceof HumanInLoopPause) throw err;
      this.logger.error(
        `[${task.id}] ReAct loop failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      await stores.taskStore.updateStatus(task.id, "FAILED", {
        completedAt: new Date(),
        resultSummary: `ReAct failure: ${err instanceof Error ? err.message : String(err)}`,
      });
      return null;
    } finally {
      taskSpan.end({ finalIteration: iteration });
    }
  }

  private async recordStep<TMetadata extends Record<string, unknown>>(
    stepStore: StepStore,
    task: AgentTask<TMetadata>,
    iteration: number,
    stepType: AgentStepType,
    payload: unknown,
    span: Span,
    metrics?: Partial<
      Pick<
        AgentStepRecord,
        | "modelId"
        | "promptTokens"
        | "completionTokens"
        | "costUsd"
        | "toolName"
        | "toolArgs"
        | "toolResult"
        | "toolLatencyMs"
        | "toolSuccess"
      >
    >,
  ): Promise<void> {
    const stepIndex = await stepStore.nextStepIndex(task.id, iteration);
    const content =
      typeof payload === "string"
        ? payload
        : JSON.stringify(payload).slice(0, 8000);
    const record: AgentStepRecord = {
      taskId: task.id,
      iteration,
      stepIndex,
      stepType,
      content,
      structuredData:
        typeof payload === "object" && payload !== null ? payload : undefined,
      traceId: span.traceId,
      spanId: span.spanId,
      parentSpanId: span.parentSpanId,
      ...metrics,
    };
    await stepStore.write(record, task.metadata);
  }

  /**
   * scope 提取：从 AgentTask.metadata 读取 scope key；tool rate limit 按此维度隔离。
   * 默认依次尝试 missionId / sessionId / taskId，app 层决定语义。
   */
  private extractScope(metadata: Record<string, unknown>): string {
    const missionId = metadata.missionId;
    if (typeof missionId === "string") return missionId;
    const sessionId = metadata.sessionId;
    if (typeof sessionId === "string") return sessionId;
    return "default";
  }

  /** 默认 self-eval：tool invocation + step count + observations 累积打分 */
  private defaultSelfEvaluate(history: ReActHistory): number {
    const toolScore = Math.min(50, history.toolInvocations.length * 10);
    const stepScore = Math.min(30, history.stepCount * 3);
    const obsScore = Math.min(20, history.observations.length * 2);
    return toolScore + stepScore + obsScore;
  }

  private summarize(draft: unknown): string {
    if (typeof draft === "string") return draft.slice(0, 200);
    try {
      return JSON.stringify(draft).slice(0, 200);
    } catch {
      return "[unstringifiable result]";
    }
  }
}
