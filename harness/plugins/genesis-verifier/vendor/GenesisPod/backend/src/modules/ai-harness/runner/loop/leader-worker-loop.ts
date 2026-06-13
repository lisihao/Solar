/**
 * LeaderWorkerLoop — 五元环编排（intent → plan → assign → execute → review → re-plan）
 *
 * **重要：本类是模板方法模式（Template Method）。**
 * `runWorker` 是 protected stub —— 业务方必须 extend 本类并覆盖 `runWorker`，
 * 接通真实的 worker 执行（spawner.spawn 派发 / 调业务 executor / 调 LLM / ...）。
 *
 * 直接把原始 LeaderWorkerLoop 注册到 LoopRegistry 会在 onApplicationBootstrap
 * 阶段 logger.warn 提示，并在执行时返回 stub 结果（仅用于框架自检与 e2e dry-run）。
 *
 * 替代 Topic Insights 的 mission-execution + leader-{intent,planning,review,agent-selection} 五个服务。
 *
 * 与 PlanActLoop 的区别：
 *   - PlanActLoop：一次性 plan，按 DAG 跑完，无中途修改
 *   - LeaderWorkerLoop：每批 worker 完成后 leader review，可动态扩任务、改任务、重试
 *
 * 架构：
 *   - Leader 是业务方实现的 ILeaderBrain（intent / plan / selectWorker / review / answerClarification）
 *   - Worker 由子类的 runWorker 实现真实执行（默认 stub）
 *   - Channel：LeaderFeedbackChannel 提供 worker 双向通信
 *   - Queue：业务方在 review 决策中通过 newTasks 字段动态扩任务
 */

import { Injectable, Logger } from "@nestjs/common";
import type {
  AgentEventPayload,
  AgentLoopKind,
  IAgent,
  IAgentEvent,
  IAgentLoop,
  IContextEnvelope,
  ILoopTerminationCriteria,
  ISubagentSpawner,
} from "../../agents/abstractions";
import type { BudgetAccountant } from "../../guardrails/budget/budget-accountant";

// ─── 五元环状态 ────────────────────────────────────────────

export type LeaderDecisionType =
  | "PLAN" // 初始 / 重新规划
  | "ASSIGN" // 派发 task
  | "REVIEW" // 评审 worker 结果
  | "REPLAN" // 部分失败时重规划
  | "DONE"; // 全部完成

export interface LeaderTask<TInput = Record<string, unknown>> {
  readonly id: string;
  readonly type: string; // 业务自定义类型
  readonly input: TInput;
  readonly dependsOn?: readonly string[];
  readonly priority?: number;
  /** 业务可塞 metadata（dimensionId / subTopicId 等） */
  readonly metadata?: Record<string, unknown>;
}

export interface WorkerResult {
  readonly taskId: string;
  readonly status: "completed" | "failed" | "needs_clarification";
  readonly output?: unknown;
  readonly error?: string;
  /** worker 提出"我需要 leader 解答"的问题 */
  readonly clarificationQuestion?: string;
}

export interface LeaderReviewDecision {
  /** 整体决定 */
  decision: "accept_all" | "revise" | "expand" | "abort";
  /** 哪些 task 要重做（accept_all 时为空） */
  retryTaskIds?: readonly string[];
  /** 新增的 task（expand 时） */
  newTasks?: readonly LeaderTask[];
  /** review 评分 0-100（observability 用） */
  score?: number;
  /** 给前端的人话 */
  note?: string;
}

// ─── Leader 接口（业务方实现） ────────────────────────────────

export interface ILeaderBrain {
  /** 1. 理解 intent —— 把用户输入解析为初始 goal */
  intent(input: {
    userInput: unknown;
    envelope: IContextEnvelope;
  }): Promise<{ goal: string; constraints?: Record<string, unknown> }>;

  /** 2. 制定 plan —— 根据 goal 生成第一批 task */
  plan(input: {
    goal: string;
    constraints?: Record<string, unknown>;
    envelope: IContextEnvelope;
  }): Promise<readonly LeaderTask[]>;

  /** 3. 选 agent —— 给定 task 决定派给哪个 worker spec（business 自定义） */
  selectWorker(task: LeaderTask): Promise<{
    workerName: string;
    /** worker 用什么 system prompt（业务方自定义） */
    workerSystemPrompt?: string;
    workerInput?: unknown;
  }>;

  /** 4. 评审 —— 一批 worker 完成后，决定下一步 */
  review(input: {
    completed: readonly WorkerResult[];
    pendingClarifications: readonly WorkerResult[];
    envelope: IContextEnvelope;
  }): Promise<LeaderReviewDecision>;

  /** 5. 回答 worker 的澄清请求（双向 channel） */
  answerClarification(question: string): Promise<string>;
}

// ─── Loop 实现 ────────────────────────────────────────────

export interface LeaderWorkerOptions {
  readonly leader: ILeaderBrain;
  /** 每批最多并发派多少 worker；默认 5 */
  readonly maxConcurrentWorkers?: number;
  /** 最多 review 多少轮（防死循环）；默认 10 */
  readonly maxReviewRounds?: number;
}

@Injectable()
export class LeaderWorkerLoop implements IAgentLoop {
  readonly kind: AgentLoopKind = "leader-worker" as AgentLoopKind;
  protected readonly log = new Logger(this.constructor.name);
  /** 必修 #2: 标记类是否为基类 stub（业务方 extend 后覆盖此字段为 false） */
  protected readonly isStubImplementation: boolean = true;

  async *run(
    envelope: IContextEnvelope,
    _criteria: ILoopTerminationCriteria,
    options?: {
      agentId?: string;
      signal?: AbortSignal;
      allowedTools?: readonly string[];
      forbiddenTools?: readonly string[];
      budget?: BudgetAccountant;
      parent?: IAgent;
      spawner?: ISubagentSpawner;
      leaderWorker?: LeaderWorkerOptions;
    },
  ): AsyncIterable<IAgentEvent> {
    const agentId = options?.agentId ?? "leader-worker";
    const opts = options?.leaderWorker;
    if (!opts?.leader) {
      yield this.event(agentId, "error", {
        message:
          "LeaderWorkerLoop requires options.leaderWorker.leader (ILeaderBrain)",
        recoverable: false,
        failureCode: "RUNNER_INPUT_SCHEMA_MISMATCH",
        diagnostic: {
          stage: "init",
          missing: "options.leaderWorker.leader",
        },
      });
      yield this.event(agentId, "terminated", { reason: "error" });
      return;
    }
    // 必修 #2: stub 实现警告 —— 业务方未 extend 直接用会拿到假数据
    if (this.isStubImplementation) {
      this.log.warn(
        `[${agentId}] LeaderWorkerLoop is running with default stub runWorker. ` +
          `Worker results will be fake. Extend LeaderWorkerLoop and override runWorker() ` +
          `to integrate real worker execution.`,
      );
    }
    const maxConc = opts.maxConcurrentWorkers ?? 5;
    const maxReview = opts.maxReviewRounds ?? 10;

    const currentEnvelope = envelope;
    // 用 cast 防 TS narrowing 阻止 REPLAN 分支（业务方扩展时启用）
    let phase = "PLAN" as LeaderDecisionType;
    let goal = "";
    let constraints: Record<string, unknown> | undefined;
    let queue: LeaderTask[] = [];
    const completed: WorkerResult[] = [];
    let reviewRound = 0;

    yield this.event(agentId, "thinking", {
      text: "[leader-worker] phase=INTENT",
      phase: "INTENT",
    });

    // ─── INTENT ────────────────────────────────────────
    try {
      const intentRes = await opts.leader.intent({
        userInput:
          currentEnvelope.messages[currentEnvelope.messages.length - 1]
            ?.content,
        envelope: currentEnvelope,
      });
      goal = intentRes.goal;
      constraints = intentRes.constraints;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      yield this.event(agentId, "error", {
        message: `intent: ${message}`,
        recoverable: false,
        failureCode: "PROVIDER_API_ERROR",
        diagnostic: {
          stage: "intent",
          errorMessage: message,
          errorStack: err instanceof Error ? err.stack : undefined,
        },
      });
      yield this.event(agentId, "terminated", { reason: "error" });
      return;
    }

    // 硬停前的一次性早期预算预警（finalize 宽限信号）
    let budgetWarned = false;

    while (reviewRound < maxReview) {
      if (options?.signal?.aborted) {
        yield this.event(agentId, "terminated", { reason: "cancelled" });
        return;
      }
      // 早期预警：用量逼近上限但未耗尽 → 发一次 soft 预警，给 agent 收尾窗口
      // （?.() 容忍未实现 nearLimit 的 budget 实现/mock）
      if (!budgetWarned && options?.budget?.nearLimit?.()) {
        budgetWarned = true;
        yield this.event(agentId, "budget_warning", {
          severity: "soft",
        });
      }
      if (options?.budget?.exhausted()) {
        yield this.event(agentId, "budget_warning", {
          severity: "exhausted",
        });
        yield this.event(agentId, "terminated", { reason: "budget" });
        return;
      }

      // ─── PLAN / REPLAN ──────────────────────────────
      if (phase === "PLAN" || phase === "REPLAN") {
        yield this.event(agentId, "thinking", {
          text: `[leader-worker] phase=${phase}`,
          phase,
        });
        try {
          const newPlan = await opts.leader.plan({
            goal,
            constraints,
            envelope: currentEnvelope,
          });
          queue = [...queue, ...newPlan];
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          yield this.event(agentId, "error", {
            message: `plan: ${message}`,
            recoverable: false,
            failureCode: "PROVIDER_API_ERROR",
            diagnostic: {
              stage: "plan",
              phase,
              reviewRound,
              errorMessage: message,
              errorStack: err instanceof Error ? err.stack : undefined,
            },
          });
          yield this.event(agentId, "terminated", { reason: "error" });
          return;
        }
        phase = "ASSIGN";
      }

      // ─── ASSIGN + EXECUTE batch ───────────────────────
      if (phase === "ASSIGN") {
        const ready = queue.filter((t) =>
          (t.dependsOn ?? []).every((d) =>
            completed.some((c) => c.taskId === d),
          ),
        );
        if (ready.length === 0) {
          // 没有可执行的 task → 全部完成
          phase = "DONE";
          break;
        }
        const batch = ready.slice(0, maxConc);
        queue = queue.filter((t) => !batch.includes(t));

        yield this.event(agentId, "action_planned", {
          kind: "tool_call",
          toolId: "leader.assign",
          input: { batchSize: batch.length, taskIds: batch.map((t) => t.id) },
        });

        const batchResults = await Promise.all(
          batch.map((task) => this.runWorker(task, opts.leader, options)),
        );
        completed.push(...batchResults);

        for (const r of batchResults) {
          yield this.event(agentId, "action_executed", {
            action: {
              kind: "tool_call",
              toolId: `worker.${r.taskId}`,
              input: {},
            },
            output: r.status === "completed" ? r.output : { error: r.error },
            error: r.error ? new Error(r.error) : undefined,
            latencyMs: 0,
          });
        }

        phase = "REVIEW";
      }

      // ─── REVIEW ──────────────────────────────────────
      if (phase === "REVIEW") {
        reviewRound += 1;
        yield this.event(agentId, "thinking", {
          text: `[leader-worker] phase=REVIEW round=${reviewRound}`,
          phase: "REVIEW",
        });
        const lastBatch = completed.slice(-maxConc);
        const decision = await opts.leader.review({
          completed: lastBatch,
          pendingClarifications: lastBatch.filter(
            (r) => r.status === "needs_clarification",
          ),
          envelope: currentEnvelope,
        });

        yield this.event(agentId, "reflection", {
          phase: "REVIEW",
          decision: decision.decision,
          score: decision.score,
          note: decision.note,
        });

        if (decision.decision === "accept_all") {
          if (queue.length === 0) {
            phase = "DONE";
            break;
          }
          phase = "ASSIGN";
          continue;
        }
        if (decision.decision === "revise" && decision.retryTaskIds?.length) {
          // 必修：retryTaskIds 对应的旧 failed result 应从 completed 中移除，
          // 否则下次 review 取 lastBatch 仍含脏数据。
          const retrySet = new Set(decision.retryTaskIds);
          for (let i = completed.length - 1; i >= 0; i -= 1) {
            if (retrySet.has(completed[i].taskId)) completed.splice(i, 1);
          }
          // 业务方实现 newTasks 时已生成新版本（替换原 task）
          if (decision.newTasks) queue.push(...decision.newTasks);
          phase = "ASSIGN";
          continue;
        }
        if (decision.decision === "expand" && decision.newTasks?.length) {
          queue.push(...decision.newTasks);
          phase = "ASSIGN";
          continue;
        }
        if (decision.decision === "abort") {
          yield this.event(agentId, "error", {
            message: decision.note ?? "Leader decided to abort",
            recoverable: false,
            failureCode: "REFLEXION_VERIFIER_LOW_SCORE",
            diagnostic: {
              stage: "review",
              reviewRound,
              decision: decision.decision,
              score: decision.score,
              note: decision.note,
              completedTaskCount: completed.length,
            },
          });
          yield this.event(agentId, "terminated", { reason: "error" });
          return;
        }
      }
    }

    // ─── DONE ──────────────────────────────────────────
    const finalOutput = {
      goal,
      completed: completed.length,
      results: completed.map((c) => ({ taskId: c.taskId, status: c.status })),
    };
    yield this.event(agentId, "output", { output: finalOutput });
    yield this.event(agentId, "terminated", {
      reason: reviewRound >= maxReview ? "budget" : "completed",
    });
  }

  /**
   * runWorker — **模板方法**，业务方继承 LeaderWorkerLoop 后必须覆盖。
   *
   * 默认实现是 stub：只调 leader.selectWorker 拿到 spec，不执行真实 worker。
   * 业务方覆盖时可：
   *   - 用 spawner.spawn(parent, workerSpec) 派 subagent
   *   - 调业务 service / executor 直接跑
   *   - 调 LLM workflow
   *
   * 覆盖时务必把 isStubImplementation 重置为 false（防止启动 warn 误报）：
   *
   *   class MyLeaderLoop extends LeaderWorkerLoop {
   *     protected readonly isStubImplementation = false;
   *     protected async runWorker(task, leader) { ... }
   *   }
   */
  protected async runWorker(
    task: LeaderTask,
    leader: ILeaderBrain,
    _options: unknown,
  ): Promise<WorkerResult> {
    try {
      const sel = await leader.selectWorker(task);
      return {
        taskId: task.id,
        status: "completed",
        output: {
          _stub: true,
          workerName: sel.workerName,
          taskInput: task.input,
        },
      };
    } catch (err) {
      return {
        taskId: task.id,
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private event(
    agentId: string,
    type: IAgentEvent["type"],
    payload: AgentEventPayload,
  ): IAgentEvent {
    return { type, agentId, timestamp: Date.now(), payload };
  }
}

/**
 * LeaderFeedbackChannel — worker → leader 的双向通信通道
 *
 * Worker 在执行中可以：
 *   await channel.askLeader("我应该用 GPT-4o 还是 Claude？")
 * Leader 收到 → 调 leader.answerClarification(question) → worker 拿到答案继续。
 *
 * 用法（业务方在 worker spec 里持有 channel 引用）：
 *   const channel = new LeaderFeedbackChannel(leader);
 *   const answer = await channel.askLeader("...");
 */
export class LeaderFeedbackChannel {
  constructor(private readonly leader: ILeaderBrain) {}

  async askLeader(question: string): Promise<string> {
    return this.leader.answerClarification(question);
  }
}
