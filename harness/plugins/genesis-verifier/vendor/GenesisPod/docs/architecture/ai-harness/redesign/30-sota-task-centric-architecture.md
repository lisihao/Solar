# SOTA Task-Centric Agent Execution Architecture

> **状态**：v1 设计定稿 · 作为后续 28 commit 权威参考
> **创建**：2026-04-24
> **维护者**：Claude Code
> **上一版**：10-review-and-gaps / 18-baseline-gap-audit / 22x 契约文档
> **驱动问题**：harness 迁移后生产 mission `25c66d73` 数据硬证据 — activities=0 / evidence=8，对比 baseline 4.22 activities=289-455 / evidence=446-1006。根因不是"prompt 对齐"而是**架构性缺失**：task-centric 单一真相 / ReAct 迭代循环 / tool function calling / multi-judge verification / OTel trace / HITL 全无。

---

## 0. 核心设计原则（不可违反）

### 0.1 架构归属第一原则（Topic Insights = 标杆）

Topic Insights 是本次 SOTA 切换的**第一个标杆 AI App**。实现过程中沉淀的**通用能力**归入 `ai-engine/harness/`，供 Research / Teams / Writing / Office / Simulation 等后续 AI App 直接复用；**业务特定实现**（Prisma schema / prompt / tool 接入）归 `ai-app/topic-insights/`。

**归属唯一判准**："如果明天做另一个 AI App，这个代码能 100% 复用吗？"

- 能复用 → `L2 ai-engine/harness/`（禁止 import 任何业务 schema）
- 不能复用（强业务字段/强业务 prompt） → `L3 ai-app/topic-insights/agent/adapters/` 或 `/protocols/`

**L2 harness 层边界（硬约束）**：

- 不得 import `ResearchTask / ResearchMission / TopicReport / AgentStep` 等业务 model
- 不得 import 任何 `ai-app/**`
- 可以 import NestJS、Node std、`@prisma/client` 的**通用类型**（`Prisma.JsonValue` 等）
- 通过**依赖注入接口**（StepStore / CheckpointStore / TaskStore / VerificationStore）消费 App 层持久化

### 0.2 执行原则

1. **Task is the only source of truth** — 执行产物、状态、trace 全挂 task；Mission 计数器、前端展示、报告章节均 derived
2. **Agent 是 ReAct 循环，不是一次性 LLM call** — 每 task 执行是完整 Observe→Think→Plan→Act→Reflect→Converge 循环，baseline 每 mission 产 ≥300 agent step 才是基准
3. **Stage 消失 / 替换为 Protocol** — stage 不是流水线，stage 是"某类 task 的 ReAct 配置"（maxIter/judges/tools/budget）
4. **Checkpointed FSM** — task 是完整状态机，任意 step 后崩溃可从 checkpoint 继续
5. **OTel-native tracing** — 每 LLM call / tool call / task 是 span，Langfuse/Jaeger 可查
6. **Cost-aware budget** — 每 step 预估 + 实际 token，超限自动 downgrade model 或 abort
7. **Multi-judge verification** — self + external + meta 三级，分歧可 escalate to human
8. **Dynamic replanning** — Leader 观察 task 产出可 spawn/merge/cancel，不再"规划一次跑到死"
9. **Human-in-loop editable state** — 任意时刻 pause → 编辑 task/evidence/prompt → resume
10. **Backpressure-aware scheduling** — task queue 有优先级+并发+rate-limit+circuit-breaker

### 0.3 归属分类（对每个组件的归属判定）

| 组件                                                                                           | 归属                                  | 通用性                                |
| ---------------------------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------- |
| ReActRunner                                                                                    | L2 harness/runtime/                   | 所有 agent 都跑 observe-think-act     |
| TaskExecutionProtocol (接口)                                                                   | L2 harness/runtime/                   | 任何 task type 的协议抽象             |
| BudgetAccountant                                                                               | L2 harness/runtime/                   | 纯计算，无 DB                         |
| ToolRegistry + Tool (接口)                                                                     | L2 harness/runtime/                   | function calling 通用                 |
| AgentTracer                                                                                    | L2 harness/runtime/                   | OTel 通用                             |
| JudgeSpec / ConsensusResolver                                                                  | L2 harness/runtime/                   | multi-judge 模式通用                  |
| StepStore / CheckpointStore / VerificationStore / TaskStore (接口)                             | L2 harness/runtime/                   | persistence 抽象                      |
| TaskQueueInterface                                                                             | L2 harness/runtime/                   | DAG 调度接口                          |
| AgentTask\<TMetadata\>（通用 DSL）                                                             | L2 harness/runtime/                   | 无业务字段，metadata 泛型             |
| AgentStepRecord / AgentAction / Message / ToolResult                                           | L2 harness/runtime/                   | 通用 DSL                              |
| **PrismaStepStore**                                                                            | L3 topic-insights/agent/adapters/     | 写 agent_steps 表                     |
| **PrismaCheckpointStore**                                                                      | L3 topic-insights/agent/adapters/     | 写 task_checkpoints 表                |
| **PrismaVerificationStore**                                                                    | L3 topic-insights/agent/adapters/     | 写 verification_records 表            |
| **ResearchTaskQueue**                                                                          | L3 topic-insights/agent/adapters/     | 操作 research_tasks 表 DAG            |
| **ResearchTaskAdapter**                                                                        | L3 topic-insights/agent/adapters/     | ResearchTask ↔ AgentTask 转换         |
| 5 个 Protocol (DimensionResearch / SectionWrite / QualityReview / ReportSynthesis / FactCheck) | L3 topic-insights/agent/protocols/    | 业务 prompt / 业务 tool / 业务 schema |
| 5 个业务 Tool (web_search / academic / scraper / evidence_persist / figure_extract)            | L3 topic-insights/agent/tools/        | 业务数据源接入                        |
| MissionOrchestrator                                                                            | L3 topic-insights/agent/orchestrator/ | 操作 research_missions 表             |
| DynamicReplanner                                                                               | L3 topic-insights/agent/orchestrator/ | Leader 业务逻辑                       |

### 0.4 标杆沉淀路径

```
Topic Insights 实现 SOTA
       ↓
  实现过程中发现通用能力
       ↓
  沉淀到 ai-engine/harness/runtime/
       ↓
Research App 复用 harness runtime + 自己的 Protocol/Adapter/Tool
       ↓
Teams / Writing / Office / Simulation 同样模式
```

**本方案 28 子项中，只有 14 个 Protocol/Adapter/Tool 归 L3（topic-insights 业务实现），14 个 Runtime/接口归 L2（harness 通用沉淀）。**

---

## 1. 当前 HEAD 状态硬诊断（为何必须 SOTA 重构）

生产数据（topic_id=fe7693ba · 本 session 本次 mission）：

| 指标                       | baseline 4.22                  | HEAD 4.24                                    | gap         |
| -------------------------- | ------------------------------ | -------------------------------------------- | ----------- |
| tasks / mission            | 12-18                          | 固定 8 (6 dim + 1 qa + 1 syn)                | 无动态 task |
| agent_activities / mission | **289-455**                    | **0**                                        | ∞           |
| evidence / mission         | 446-1006                       | 8                                            | 100x        |
| task.status 终态正确率     | 100% (baseline scheduler 驱动) | quality_review/report_synthesis 永远 PENDING | 已死        |
| Mission.completed_tasks    | 正确                           | 永远 0                                       | 已死        |
| 研究耗时 per dim           | 30-60s                         | 0s "秒完成"                                  | 假完成      |
| 前端 Agent 活动面板        | 每 task ≥30 条                 | 空白                                         | 完全不可用  |

**根因 3 条**（不是"补一下 prompt"能解决的）：

1. harness pipeline stage 产物落 `dimensionAnalysis/topicReport` → **绕过 ResearchTask 行** → task 永远 PENDING
2. stage.execute 一次性 `runner.executeSpec()` → **无 ReAct 迭代** → 没机会产生 activity/step
3. 没有 tool registry + function calling → **agent 无法自主规划工具调用** → 研究深度为 0

本次 session 前 10 commit 修的是外围（prompt/sanitize/schema 对齐），**核心 3 断点未动**，所以生产跑出来和修前一样烂。

---

## 2. 目标架构

### 2.1 分层图

```
┌────────────────────────────────────────────────────────────────┐
│  Layer 0 · API / Realtime                                      │
│    LeaderChat · Mission API · Task HITL Controls · WebSocket   │
└──────────────────────────┬─────────────────────────────────────┘
                           │
┌──────────────────────────▼─────────────────────────────────────┐
│  Layer 1 · Mission Orchestrator (thin)                         │
│    · enqueue initial tasks 到 TaskQueue                         │
│    · subscribe task 状态变更 → 喂 DynamicReplanner              │
│    · mission 终态（全 task COMPLETED/FAILED）时 finalize         │
└──────────────────────────┬─────────────────────────────────────┘
                           │
┌──────────────────────────▼─────────────────────────────────────┐
│  Layer 2 · TaskQueue + DAG Scheduler                           │
│    · BullMQ + Redis · 优先级 · 并发控制 · retry · DLQ           │
│    · DAG 依赖解析：只 schedule dependsOn 全 COMPLETED 的 task    │
│    · checkpointer resume：worker 崩溃恢复从 checkpoint 继续      │
└──────────────────────────┬─────────────────────────────────────┘
                           │  dequeue task
┌──────────────────────────▼─────────────────────────────────────┐
│  Layer 3 · Protocol Registry                                   │
│    · taskType → TaskExecutionProtocol 映射                      │
│    · 每 Protocol 声明：maxIter / judges / tools / budget /      │
│      initialPrompt / resultSchema                              │
└──────────────────────────┬─────────────────────────────────────┘
                           │
┌──────────────────────────▼─────────────────────────────────────┐
│  Layer 4 · ReAct Agent Runtime (共享核心)                      │
│    while (!converged && iter < maxIter):                       │
│      Observe → Think → Plan → Act → Reflect → SelfEval         │
│      每 step persist AgentStep + OTel span + checkpoint         │
│      budget guard 降档                                         │
└──────────────────────────┬─────────────────────────────────────┘
                           │
┌──────────────────────────▼─────────────────────────────────────┐
│  Layer 5 · Tool Registry (function calling native)             │
│    每 tool: id/schema/cost_estimate/rate_limit/retry/circuit   │
│    web_search / academic / scraper / rag / evidence_persist /  │
│    figure_extract / llm_call_ref / memory_lookup / ...          │
└──────────────────────────┬─────────────────────────────────────┘
                           │
┌──────────────────────────▼─────────────────────────────────────┐
│  Layer 6 · Verification                                        │
│    SelfJudge (same agent, higher temperature re-eval)           │
│    ExternalJudge A+B (不同 model cross-check)                   │
│    MetaJudge (仲裁分歧)                                         │
│    → VerificationRecord 落 task 行                              │
└──────────────────────────┬─────────────────────────────────────┘
                           │
┌──────────────────────────▼─────────────────────────────────────┐
│  Layer 7 · Observability                                       │
│    OTel span：mission → task → react_iteration → llm / tool    │
│    Export：Langfuse (primary) + console (dev) + DB mirror      │
│    前端订阅 AgentStep 实时流                                    │
└────────────────────────────────────────────────────────────────┘
```

### 2.2 关键架构决策

| 决策点           | 选择                                                        | 原因                                                                   |
| ---------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------- |
| Task 队列        | BullMQ on Redis                                             | 已有 Redis 基础设施；工业级 retry/priority/rate-limit；不引入新 broker |
| Workflow engine  | 自研 Prisma-backed checkpointer（先）                       | Temporal 过重，自研 80 行够用；后期可替换                              |
| Trace            | OpenTelemetry + Langfuse exporter                           | LLM-native observability 事实标准                                      |
| Function calling | OpenAI tool_use schema                                      | 所有主流 model 兼容（Claude / GPT / Grok）                             |
| Judges           | 异构 model cross-check                                      | FeRefinement / Self-Consistency 思路                                   |
| FSM              | Prisma enum + state machine library (`typestate` or inline) | 轻量                                                                   |
| Dynamic replan   | Leader agent 在 task COMPLETED 事件上 react                 | 基于事件，非轮询                                                       |

---

## 3. 数据模型（Phase 1）

### 3.1 ResearchTask（扩展为 FSM + 执行真相）

```prisma
enum TaskStatus {
  CREATED
  QUEUED
  SCHEDULED
  RUNNING
  PAUSED
  AWAITING_HUMAN
  VERIFYING
  NEEDS_REVISION
  COMPLETED
  FAILED
  CANCELLED
}

model ResearchTask {
  // ...existing fields...
  status              TaskStatus @default(CREATED)

  // ReAct execution state
  currentIteration    Int @default(0)
  maxIterations       Int @default(20)
  lastCheckpointId    String? @map("last_checkpoint_id")

  // retry + verification
  retryCount          Int @default(0)
  maxRetries          Int @default(2)
  requiresRevision    Boolean @default(false)

  // budget accounting
  tokenBudget         Int?
  tokensUsed          Int @default(0)
  costUsd             Decimal @default(0)
  latencyMs           Int @default(0)

  // parent-child (动态 spawn sub-task)
  parentTaskId        String? @map("parent_task_id")
  parent              ResearchTask? @relation("TaskTree", fields: [parentTaskId], references: [id])
  children            ResearchTask[] @relation("TaskTree")

  // relations (新增)
  steps               AgentStep[]
  checkpoints         TaskCheckpoint[]
  verifications       VerificationRecord[]

  // result (JSON blob, schema 由 protocol 定义)
  result              Json?
  resultSummary       String?
  resultScore         Int? // 0-100

  // timestamps 扩展
  queuedAt            DateTime?
  scheduledAt         DateTime?
  pausedAt            DateTime?
  resumedAt           DateTime?

  @@index([missionId, status])
  @@index([parentTaskId])
  @@index([status, scheduledAt]) // queue puller 用
}
```

### 3.2 AgentStep（替代 ResearchAgentActivity，step-level 粒度）

```prisma
enum AgentStepType {
  OBSERVE
  THINK
  PLAN
  TOOL_CALL
  TOOL_RESULT
  REFLECT
  SELF_EVAL
  JUDGE_EVAL
  HUMAN_INPUT
  CHECKPOINT
  DONE
}

model AgentStep {
  id                  String @id @default(uuid())
  taskId              String @map("task_id")
  task                ResearchTask @relation(fields: [taskId], references: [id], onDelete: Cascade)
  missionId           String @map("mission_id")
  topicId             String @map("topic_id")

  iteration           Int
  stepIndex           Int
  stepType            AgentStepType

  // LLM call
  modelId             String?
  promptTokens        Int?
  completionTokens    Int?
  costUsd             Decimal?

  // tool call
  toolName            String?
  toolArgs            Json?
  toolResult          Json?
  toolLatencyMs       Int?
  toolSuccess         Boolean?

  // content (thought / plan / reflection text)
  content             String? @db.Text
  structuredData      Json?

  // OTel
  traceId             String?
  spanId              String?
  parentSpanId        String?

  createdAt           DateTime @default(now())

  @@index([taskId, iteration, stepIndex])
  @@index([missionId, createdAt])
  @@index([traceId])
}
```

### 3.3 TaskCheckpoint（崩溃恢复锚点）

```prisma
model TaskCheckpoint {
  id              String @id @default(uuid())
  taskId          String @map("task_id")
  task            ResearchTask @relation(fields: [taskId], references: [id], onDelete: Cascade)

  iteration       Int
  stepIndex       Int

  // 恢复需要的快照
  observations    Json    // 历史 observations
  reasoningMemory Json    // scratchpad
  toolInvocationHistory Json
  budgetSnapshot  Json

  // status
  status          TaskStatus
  reason          String? // "budget_exhausted" | "human_pause" | "crash_recovery" | ...

  createdAt       DateTime @default(now())

  @@index([taskId, createdAt])
}
```

### 3.4 VerificationRecord（多 judge 审核记录）

```prisma
model VerificationRecord {
  id              String @id @default(uuid())
  taskId          String @map("task_id")
  task            ResearchTask @relation(fields: [taskId], references: [id], onDelete: Cascade)

  iteration       Int

  judgeVerdicts   Json    // [{judgeId, score, critique, criteria}, ...]
  consensus       String  // 'pass' | 'fail' | 'escalate_to_meta' | 'escalate_to_human'
  decidedScore    Int
  metaJudgeNote   String?

  createdAt       DateTime @default(now())

  @@index([taskId, createdAt])
}
```

---

## 4. 核心 Runtime：ReAct Loop（Phase 2）

### 4.1 抽象接口

```ts
// backend/src/modules/ai-app/topic-insights/agent/runtime/react-loop.ts

export abstract class TaskExecutionProtocol<TResult> {
  abstract readonly taskType: string;
  abstract readonly maxIterations: number;
  abstract readonly convergenceThreshold: number; // 0-1, self-eval score
  abstract readonly budgetCap: TokenBudget;
  abstract readonly allowedTools: string[];
  abstract readonly judges: JudgeSpec[];

  abstract buildInitialContext(
    task: ResearchTask,
    mission: MissionContext,
  ): Promise<AgentContext>;
  abstract assembleResult(task: ResearchTask, steps: AgentStep[]): TResult;

  /** 子类可 override 来约束 action 解析 */
  parseAction(llmOutput: LLMResponse, ctx: AgentContext): AgentAction {
    // default：从 function_call / tool_use 解析
    if (llmOutput.toolCalls?.length) {
      return { kind: "tool_call", tool: llmOutput.toolCalls[0] };
    }
    if (llmOutput.content.match(/\[DONE\]/)) return { kind: "done" };
    return { kind: "think_more", thought: llmOutput.content };
  }
}

export interface AgentContext {
  task: ResearchTask;
  mission: MissionContext;
  systemPrompt: string;
  initialMessages: Message[];
  observations: Observation[];
  toolRegistry: ToolRegistry;
  llm: LLMService;
  checkpointer: TaskCheckpointer;
  tracer: Tracer;
  budget: BudgetAccountant;
}

export interface AgentAction {
  kind: "tool_call" | "done" | "think_more" | "need_human" | "abort";
  tool?: string;
  args?: Record<string, unknown>;
  thought?: string;
  rationale?: string;
}

export interface LLMResponse {
  content: string;
  toolCalls?: ToolCall[];
  reasoning?: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  modelId: string;
  spanId: string;
}
```

### 4.2 ReAct 执行环（通用 runner）

```ts
export class ReActRunner {
  constructor(
    private readonly protocols: ProtocolRegistry,
    private readonly prisma: PrismaService,
    private readonly tracer: Tracer,
  ) {}

  async execute(task: ResearchTask): Promise<TaskResult | null> {
    const protocol = this.protocols.get(task.taskType);
    const mission = await this.loadMission(task.missionId);
    const ctx = await protocol.buildInitialContext(task, mission);

    // 恢复 checkpoint
    const resumePoint = await ctx.checkpointer.loadLatest(task.id);
    if (resumePoint) {
      ctx.observations = resumePoint.observations;
      task.currentIteration = resumePoint.iteration;
    }

    // 进入 ReAct loop
    await this.transitionStatus(task, "RUNNING");
    let converged = false;

    const missionSpan = this.tracer.startSpan(`task.${task.taskType}`, {
      attributes: { taskId: task.id, missionId: task.missionId },
    });

    try {
      while (!converged && task.currentIteration < protocol.maxIterations) {
        const iterSpan = this.tracer.startSpan(
          `react.iter.${task.currentIteration}`,
          {
            parent: missionSpan,
          },
        );

        // 1. Observe
        const observation = await this.observe(task, ctx);
        await this.recordStep(task, "OBSERVE", observation, iterSpan);

        // 2. Think
        const thought = await ctx.llm.call({
          messages: this.buildMessages(ctx, observation),
          tools: protocol.allowedTools.map(
            (id) => ctx.toolRegistry.get(id).schema,
          ),
          model: ctx.budget.chooseModel(protocol.budgetCap),
          span: iterSpan,
        });
        await this.recordStep(task, "THINK", thought.content, iterSpan, {
          promptTokens: thought.promptTokens,
          completionTokens: thought.completionTokens,
          costUsd: thought.costUsd,
        });

        // 3. Plan (parse LLM output to action)
        const action = protocol.parseAction(thought, ctx);
        await this.recordStep(task, "PLAN", action, iterSpan);

        // 4. Act
        if (action.kind === "done") {
          converged = true;
          iterSpan.end();
          break;
        }
        if (action.kind === "need_human") {
          await this.transitionStatus(task, "AWAITING_HUMAN");
          throw new HumanInLoopPause(task.id, action);
        }
        if (action.kind === "tool_call") {
          const toolResult = await ctx.toolRegistry.execute(
            action.tool!,
            action.args!,
            { taskId: task.id, span: iterSpan },
          );
          await this.recordStep(task, "TOOL_CALL", action, iterSpan);
          await this.recordStep(task, "TOOL_RESULT", toolResult, iterSpan);
          ctx.observations.push({ source: action.tool!, data: toolResult });
        }

        // 5. Reflect + SelfEval
        const selfEval = await this.selfEvaluate(task, ctx, protocol);
        await this.recordStep(task, "SELF_EVAL", selfEval, iterSpan);
        if (selfEval.score >= protocol.convergenceThreshold) converged = true;

        // 6. Budget guard
        if (ctx.budget.exhausted()) {
          if (ctx.budget.canDowngrade()) ctx.budget.downgrade();
          else {
            await this.gracefulAbort(task, "budget_exhausted");
            iterSpan.end();
            break;
          }
        }

        // 7. Checkpoint
        await ctx.checkpointer.save(task.id, {
          iteration: task.currentIteration,
          observations: ctx.observations,
          reasoningMemory: ctx.scratchpad,
        });

        task.currentIteration++;
        await this.prisma.researchTask.update({
          where: { id: task.id },
          data: { currentIteration: task.currentIteration },
        });
        iterSpan.end();
      }

      const draft = protocol.assembleResult(
        task,
        await this.loadSteps(task.id),
      );

      // 8. Multi-judge verification
      await this.transitionStatus(task, "VERIFYING");
      const verdicts = await Promise.all(
        protocol.judges.map((j) => j.evaluate(draft, task, ctx)),
      );
      const decision = this.consensus(verdicts);
      await this.prisma.verificationRecord.create({
        data: {
          taskId: task.id,
          iteration: task.currentIteration,
          judgeVerdicts: verdicts,
          consensus: decision.verdict,
          decidedScore: decision.score,
        },
      });

      if (decision.verdict === "escalate_to_human") {
        await this.transitionStatus(task, "AWAITING_HUMAN");
        return null;
      }
      if (decision.verdict === "fail") {
        if (task.retryCount < task.maxRetries) {
          task.retryCount++;
          await this.reset(task);
          return this.execute(task); // retry
        }
        await this.transitionStatus(task, "FAILED");
        return null;
      }

      // COMPLETED — 写 task.result（单一真相）
      await this.prisma.researchTask.update({
        where: { id: task.id },
        data: {
          status: "COMPLETED",
          result: draft as Prisma.JsonObject,
          resultSummary: this.summarize(draft),
          resultScore: decision.score,
          completedAt: new Date(),
        },
      });

      return draft;
    } finally {
      missionSpan.end();
    }
  }

  private async recordStep(
    task: ResearchTask,
    stepType: AgentStepType,
    payload: unknown,
    span: Span,
    metrics?: StepMetrics,
  ): Promise<void> {
    await this.prisma.agentStep.create({
      data: {
        taskId: task.id,
        missionId: task.missionId,
        topicId: task.topicId!,
        iteration: task.currentIteration,
        stepIndex: await this.nextStepIndex(task.id),
        stepType,
        content:
          typeof payload === "string" ? payload : JSON.stringify(payload),
        structuredData:
          typeof payload === "object"
            ? (payload as Prisma.JsonObject)
            : undefined,
        ...metrics,
        traceId: span.spanContext().traceId,
        spanId: span.spanContext().spanId,
      },
    });
  }
}
```

### 4.3 TaskCheckpointer（Prisma-backed）

```ts
export class TaskCheckpointer {
  constructor(private readonly prisma: PrismaService) {}

  async save(taskId: string, data: CheckpointData): Promise<void> {
    await this.prisma.taskCheckpoint.create({
      data: {
        taskId,
        iteration: data.iteration,
        stepIndex: data.stepIndex ?? 0,
        observations: data.observations as Prisma.JsonArray,
        reasoningMemory: data.reasoningMemory as Prisma.JsonObject,
        toolInvocationHistory: data.toolInvocationHistory as Prisma.JsonArray,
        budgetSnapshot: data.budgetSnapshot as Prisma.JsonObject,
        status: "RUNNING",
      },
    });
  }

  async loadLatest(taskId: string): Promise<CheckpointData | null> {
    const cp = await this.prisma.taskCheckpoint.findFirst({
      where: { taskId },
      orderBy: { createdAt: "desc" },
    });
    if (!cp) return null;
    return {
      iteration: cp.iteration,
      stepIndex: cp.stepIndex,
      observations: cp.observations as Observation[],
      reasoningMemory: cp.reasoningMemory as Scratchpad,
      toolInvocationHistory: cp.toolInvocationHistory as ToolInvocation[],
      budgetSnapshot: cp.budgetSnapshot as BudgetSnapshot,
    };
  }
}
```

### 4.4 BudgetAccountant（cost-aware downgrade）

```ts
export class BudgetAccountant {
  constructor(
    private readonly cap: TokenBudget,
    private readonly modelRegistry: ModelRegistry,
  ) {}

  tokensUsed = 0;
  costUsd = 0;
  currentTier: "strong" | "standard" | "basic" = "strong";

  exhausted(): boolean {
    return (
      this.tokensUsed >= this.cap.maxTokens ||
      this.costUsd >= this.cap.maxCostUsd
    );
  }

  canDowngrade(): boolean {
    return this.currentTier !== "basic";
  }

  downgrade(): void {
    this.currentTier = this.currentTier === "strong" ? "standard" : "basic";
  }

  chooseModel(preference: ModelPreference): string {
    // 根据当前 tier + preference 选 modelId
    return this.modelRegistry.pickByTier(this.currentTier, preference);
  }

  accountLLM(tokens: number, costUsd: number): void {
    this.tokensUsed += tokens;
    this.costUsd += costUsd;
  }

  accountTool(costUsd: number): void {
    this.costUsd += costUsd;
  }
}
```

### 4.5 ToolRegistry（function calling native）

```ts
export interface Tool<TArgs, TResult> {
  readonly id: string;
  readonly description: string;
  readonly argsSchema: JSONSchema; // OpenAI function schema
  readonly resultSchema: JSONSchema;
  readonly costEstimate: (args: TArgs) => number; // 预估 token
  readonly rateLimit: RateLimitPolicy;
  readonly retry: RetryPolicy;
  readonly circuit: CircuitBreakerPolicy;
  execute(args: TArgs, ctx: ToolExecContext): Promise<TResult>;
}

export class ToolRegistry {
  private readonly tools = new Map<string, Tool<any, any>>();

  register(tool: Tool<any, any>): void {
    this.tools.set(tool.id, tool);
  }

  get(id: string): Tool<any, any> {
    const t = this.tools.get(id);
    if (!t) throw new Error(`Tool '${id}' not registered`);
    return t;
  }

  async execute(
    id: string,
    args: unknown,
    ctx: ToolExecContext,
  ): Promise<ToolResult> {
    const tool = this.get(id);
    const span = ctx.tracer.startSpan(`tool.${id}`, { parent: ctx.span });
    const started = Date.now();
    try {
      const result = await this.withRetryAndCircuit(tool, args, ctx);
      span.setAttributes({ success: true, latencyMs: Date.now() - started });
      return { success: true, data: result, latencyMs: Date.now() - started };
    } catch (err) {
      span.recordException(err as Error);
      return {
        success: false,
        error: (err as Error).message,
        latencyMs: Date.now() - started,
      };
    } finally {
      span.end();
    }
  }
}
```

---

## 5. Task Protocols（Phase 3）

### 5.1 DimensionResearchProtocol

```ts
export class DimensionResearchProtocol extends TaskExecutionProtocol<DimensionResult> {
  readonly taskType = "dimension_research";
  readonly maxIterations = 80; // 对齐 baseline 每 dim 30-80 step
  readonly convergenceThreshold = 0.85;
  readonly budgetCap = { maxTokens: 80_000, maxCostUsd: 0.5 };
  readonly allowedTools = [
    "web_search",
    "academic_search",
    "scraper",
    "rag_search",
    "evidence_persist",
    "figure_extract",
    "memory_lookup",
  ];
  readonly judges = [
    new SelfJudge({ modelSwap: true }),
    new ExternalJudge({ judgeModel: "claude-sonnet-4-6" }),
  ];

  async buildInitialContext(task, mission) {
    return {
      systemPrompt: DIMENSION_RESEARCH_SYSTEM_PROMPT,
      initialMessages: [
        {
          role: "user",
          content:
            `研究维度"${task.dimensionName}"：\n` +
            `${task.description}\n` +
            `分配技能：${task.skills.join(", ")}\n` +
            `参考证据需要 ≥ 10 条不同来源`,
        },
      ],
      observations: [],
      // ...
    };
  }

  assembleResult(task, steps): DimensionResult {
    const lastThought = steps.filter((s) => s.stepType === "THINK").pop();
    const evidenceGathered = steps
      .filter(
        (s) =>
          s.stepType === "TOOL_RESULT" && s.toolName === "evidence_persist",
      )
      .flatMap((s) => (s.structuredData as any).evidenceIds);
    return {
      dimensionId: task.dimensionId,
      summary: this.extractSummary(lastThought?.content ?? ""),
      keyFindings: this.extractKeyFindings(steps),
      evidenceIds: evidenceGathered,
      trends: this.extractTrends(steps),
      challenges: this.extractChallenges(steps),
      opportunities: this.extractOpportunities(steps),
    };
  }
}
```

### 5.2 SectionWriteProtocol / QualityReviewProtocol / ReportSynthesisProtocol / FactCheckProtocol

（结构类似，maxIter/judges/tools 按 task-type 定制；详见代码实现）

---

## 6. Verification 层（Phase 4）

### 6.1 三级 Judge

```ts
// 1. SelfJudge: 同 agent 不同温度 re-eval
class SelfJudge implements JudgeSpec {
  judgeId = 'self';
  async evaluate(draft, task, ctx): Promise<Verdict> {
    const reEval = await ctx.llm.call({
      messages: [
        { role: 'system', content: SELF_EVAL_PROMPT },
        { role: 'user', content: this.formatDraftForEval(draft) },
      ],
      temperature: 0.2,    // 低温严谨评估
    });
    return this.parseVerdict(reEval);
  }
}

// 2. ExternalJudge: 不同 model cross-check
class ExternalJudge implements JudgeSpec {
  judgeId: string;
  constructor(opts: { judgeModel: string }) {
    this.judgeId = `external_${opts.judgeModel}`;
  }
  async evaluate(draft, task, ctx): Promise<Verdict> {
    const externalLLM = ctx.modelRegistry.getLLM(this.judgeModel);
    const result = await externalLLM.call({
      messages: [
        { role: 'system', content: EXTERNAL_JUDGE_PROMPT },
        { role: 'user', content: this.formatDraftForEval(draft) },
      ],
    });
    return this.parseVerdict(result);
  }
}

// 3. MetaJudge: 分歧仲裁
class MetaJudge {
  async resolve(verdicts: Verdict[]): Promise<ConsensusDecision> {
    const scores = verdicts.map(v => v.score);
    const variance = stddev(scores);
    if (variance < 10) return { verdict: 'pass', score: mean(scores) };
    if (variance < 25) {
      // 分歧中等，meta llm 仲裁
      const metaResult = await this.metaLLM.call({ messages: [...] });
      return this.parseMetaVerdict(metaResult);
    }
    // 分歧大，升级 human
    return { verdict: 'escalate_to_human', score: mean(scores) };
  }
}
```

### 6.2 Consensus 算法

```ts
function consensus(verdicts: Verdict[]): ConsensusDecision {
  const passCount = verdicts.filter((v) => v.score >= 70).length;
  if (passCount === verdicts.length)
    return { verdict: "pass", score: mean(verdicts.map((v) => v.score)) };
  if (passCount === 0)
    return { verdict: "fail", score: mean(verdicts.map((v) => v.score)) };
  // 分歧 → metaJudge
  return metaJudge.resolve(verdicts);
}
```

---

## 7. Dynamic Replanning（Phase 5）

Leader agent 订阅 task COMPLETED 事件，周期观察并决定是否动态调整 task graph：

```ts
class DynamicReplanner {
  @OnEvent("task.completed")
  async onTaskCompleted(event: { taskId: string; missionId: string }) {
    const mission = await this.loadMission(event.missionId);
    const completedFrac = mission.completedTasks / mission.totalTasks;

    // 每 25% 进度让 Leader 观察一次
    if (this.shouldObserve(completedFrac)) {
      const obs = await this.gatherObservations(mission);
      const decision = await this.leaderAgent.replan(obs);

      for (const op of decision.operations) {
        switch (op.kind) {
          case "spawn_subtask":
            await this.taskQueue.enqueue(op.newTask);
            break;
          case "merge_dimensions":
            await this.mergeTasks(op.taskIds);
            break;
          case "abort_dimension":
            await this.taskQueue.cancel(op.taskId);
            break;
          case "add_judge":
            await this.addExtraJudge(op.taskId, op.judgeSpec);
            break;
          case "extend_budget":
            await this.extendBudget(op.taskId, op.extraBudget);
            break;
        }
      }
    }
  }
}
```

---

## 8. Human-in-the-Loop（Phase 6）

### 8.1 Pause / Edit / Resume / Inject API

```ts
@Controller("api/missions/:missionId")
class MissionControlController {
  @Post("pause")
  async pause(@Param("missionId") id: string): Promise<void> {
    await this.orchestrator.pause(id);
  }

  @Post("tasks/:taskId/edit")
  async edit(
    @Param("taskId") taskId: string,
    @Body() edits: TaskEdits,
  ): Promise<ResearchTask> {
    // 允许编辑 result / skills / prompt / tools
    await this.assertPaused(taskId);
    return this.prisma.researchTask.update({
      where: { id: taskId },
      data: edits,
    });
  }

  @Post("tasks/:taskId/resume")
  async resume(@Param("taskId") taskId: string): Promise<void> {
    await this.orchestrator.resumeTask(taskId);
  }

  @Post("tasks/inject")
  async inject(@Body() dto: InjectTaskDto): Promise<ResearchTask> {
    // 用户手动插入新 task
    return this.orchestrator.injectTask(dto);
  }
}
```

### 8.2 WebSocket AgentStep 实时流

```ts
@WebSocketGateway({ namespace: "/topic-insights" })
export class AgentStepGateway {
  @OnEvent("agent.step")
  handleStep(@MessageBody() step: AgentStep): void {
    this.server.to(`mission:${step.missionId}`).emit("agent_step", {
      taskId: step.taskId,
      iteration: step.iteration,
      stepType: step.stepType,
      content: step.content,
      toolName: step.toolName,
      createdAt: step.createdAt,
    });
  }
}
```

前端订阅后 AgentStep 实时出现在活动面板，不再空白。

---

## 9. OTel Tracing（Phase 2 子项）

```ts
// backend/src/modules/ai-app/topic-insights/agent/runtime/tracer.ts
import { trace, Tracer, Span } from "@opentelemetry/api";
import { LangfuseExporter } from "langfuse";

export const tracer: Tracer = trace.getTracer("topic-insights-agent", "1.0");

// 嵌套结构：
// mission.run
//   ├─ task.dimension_research
//   │    ├─ react.iter.0
//   │    │    ├─ llm.call (gpt-5.4, 1200 tokens)
//   │    │    └─ tool.web_search (serper)
//   │    ├─ react.iter.1
//   │    │    ├─ llm.call
//   │    │    └─ tool.academic_search
//   │    └─ verification
//   │         ├─ judge.self
//   │         └─ judge.external_claude
//   ├─ task.quality_review
//   └─ task.report_synthesis
```

Langfuse 导出后在 UI 可见整棵调用树 + token 成本 + latency。

---

## 10. Task Queue + DAG Scheduler（Phase 2 子项）

```ts
// 基于 BullMQ
const taskQueue = new Queue("research-tasks", { connection: redisConnection });

// Producer: 从 st-01-plan seedResearchTasks 之后，enqueue 所有 PENDING task
for (const task of seededTasks) {
  await taskQueue.add(
    "execute-task",
    { taskId: task.id },
    {
      priority: task.priority,
      attempts: task.maxRetries + 1,
      backoff: { type: "exponential", delay: 5000 },
    },
  );
}

// Worker: 消费 queue
const worker = new Worker(
  "research-tasks",
  async (job) => {
    const task = await prisma.researchTask.findUnique({
      where: { id: job.data.taskId },
    });
    if (!task) throw new Error("task not found");

    // DAG 检查：dependsOn 全 COMPLETED 才能执行
    if (task.dependsOn?.length) {
      const deps = await prisma.researchTask.findMany({
        where: { id: { in: task.dependsOn } },
        select: { status: true },
      });
      const allDone = deps.every((d) => d.status === "COMPLETED");
      if (!allDone) {
        // 延后 30s 重新入队
        throw new DelayedDependencyError(30_000);
      }
    }

    await reactRunner.execute(task);
  },
  { concurrency: 8, connection: redisConnection },
);
```

---

## 11. 迁移路径（Phase 5 Commit 24）

### 11.1 保留 / 替换 / 删除

| HEAD 组件                                           | SOTA 处理                                  |
| --------------------------------------------------- | ------------------------------------------ |
| `mission/pipeline/stages/*`                         | 替换：stage 逻辑融入 TaskExecutionProtocol |
| `mission/pipeline/pipeline-orchestrator.service.ts` | 替换：换成 TaskQueue + ReActRunner 组合    |
| `agent/specs/*` (AG-01-LD 等)                       | 保留：agent spec 定义仍由 Protocol 引用    |
| `shared/config/plan-post-process.ts` 等             | 保留：util 复用                            |
| `ResearchTask` model                                | 扩展（Phase 1 schema）                     |
| `ResearchAgentActivity` table                       | 删除 / 迁移为 AgentStep                    |
| `dimensionAnalysis` / `topicReport` table           | 保留但降级为 view — 从 task.result 物化    |

### 11.2 Feature flag 平滑切换

```ts
// common/config/feature-flags.ts
export const FLAGS = {
  USE_SOTA_AGENT_RUNTIME: process.env.USE_SOTA_AGENT_RUNTIME === 'true',
};

// mission/control/execution.service.ts
async runMission(mission) {
  if (FLAGS.USE_SOTA_AGENT_RUNTIME) {
    return this.sotaOrchestrator.run(mission);
  }
  return this.legacyHarnessOrchestrator.run(mission); // 旧路径，Phase 7 后删除
}
```

---

## 12. 验收标准（Phase 7）

生产 mission（thorough depth, 6 dim）执行后：

| 指标                    | 目标                       | 当前 HEAD            |
| ----------------------- | -------------------------- | -------------------- |
| Mission.status 终态     | COMPLETED                  | EXECUTING (永不完成) |
| Mission.completed_tasks | == total_tasks             | 0                    |
| AgentStep count         | ≥ 300                      | 0                    |
| Tool invocations        | ≥ 50                       | ~8                   |
| Evidence count          | ≥ 200                      | 8                    |
| Verification records    | ≥ 8 (每 task 至少 2 judge) | 0                    |
| Task.result 填充率      | 100%                       | 0%                   |
| Report.full_report 长度 | ≥ 2000 字                  | 0 字                 |
| OTel trace export       | Langfuse 可见              | 无                   |
| HITL pause/resume       | 功能可用                   | 无                   |

---

## 13. 非目标（explicitly out of scope）

- 不改 Leader Planning 层（AG-01-LD 已经在本 session 对齐 baseline）
- 不改 knowledge/search 层 adapter（serper/tavily/academic 等保留）
- 不引入新 DB（BullMQ 用已有 Redis）
- 不引入新 message queue（复用 Redis）
- 不做前端改造（WebSocket payload schema 兼容即可，前端自动用新数据）
- 不实现 cross-mission memory（scope：单 mission 内 agent memory）

---

## 14. 实施 Commit 列表（7 个 Phase-level commit）

> 用户要求每个 Phase 一个 commit（不拆子项）。以下标注每 commit 包含的子项清单，但 git 只提交 7 次，每次一个 Phase 完整交付。

## 14a. 子项参考（细化视图）

### Phase 1 · 数据模型改造

1. `schema: extend ResearchTask with FSM + ReAct fields`
2. `schema: new AgentStep table (replaces ResearchAgentActivity)`
3. `schema: new TaskCheckpoint table`
4. `schema: new VerificationRecord table`
5. `migration: hand-written SQL migration for FSM + new tables`

### Phase 2 · 核心 Runtime

6. `feat(agent): ReActRunner + TaskExecutionProtocol abstraction`
7. `feat(agent): TaskCheckpointer (Prisma-backed crash recovery)`
8. `feat(agent): BudgetAccountant (cost-aware downgrade)`
9. `feat(agent): ToolRegistry + function-calling schema`
10. `feat(agent): OTel Tracer + Langfuse exporter`
11. `feat(agent): BullMQ TaskQueue + DAG Scheduler`

### Phase 3 · Task Protocols

12. `feat(protocol): DimensionResearchProtocol (maxIter=80)`
13. `feat(protocol): SectionWriteProtocol`
14. `feat(protocol): QualityReviewProtocol`
15. `feat(protocol): ReportSynthesisProtocol`
16. `feat(protocol): FactCheckProtocol`
17. `feat(protocol): ProtocolRegistry + taskType routing`

### Phase 4 · Verification

18. `feat(verification): SelfJudge`
19. `feat(verification): ExternalJudge + MetaJudge`
20. `feat(verification): Consensus + escalation policy`

### Phase 5 · Orchestration

21. `feat(orchestrator): thin MissionOrchestrator (enqueue + finalize)`
22. `feat(orchestrator): DynamicReplanner (Leader-driven)`
23. `feat(orchestrator): DependencyScheduler (task DAG)`
24. `refactor: replace harness pipeline stages with protocol execution`

### Phase 6 · Human-in-Loop

25. `feat(api): pause/edit/resume/inject endpoints`
26. `feat(realtime): WebSocket AgentStep stream`

### Phase 7 · 迁移 + 验证

27. `refactor: migrate dimensionAnalysis/topicReport to derived views`
28. `feat: production verification — mission 达标 ≥300 step + report ≥2000 字`

---

## 15. 风险与缓解

| 风险                                           | 缓解                                                                             |
| ---------------------------------------------- | -------------------------------------------------------------------------------- |
| Prisma migration 在生产 33 个老 dim 数据上失败 | 迁移前 backup + 用 ALTER 非破坏性 + 新字段 nullable                              |
| BullMQ worker OOM（多 task 并行）              | concurrency=8 起步，每个 task 有 budgetCap，Redis 连接池限制                     |
| Langfuse 成本                                  | self-host 或 只在 dev/stage 开 export，prod 用 console exporter                  |
| ReAct loop 陷入无限 tool call                  | maxIterations=80 硬上限 + budget exhausted 强制退出 + self-eval 没进展自动 abort |
| 两套代码路径共存期 bug                         | Feature flag + 全路径 unit + e2e 测试 + 灰度切换                                 |
| 生产 mission 半跑时切换                        | 旧 mission 跑完老路径，新 mission 走新路径；flag 读 mission.runtime_version 字段 |

---

## 16. 决策日志

| 日期       | 决策                                                       | 依据                       |
| ---------- | ---------------------------------------------------------- | -------------------------- |
| 2026-04-24 | 放弃"投影层"方案，task 为单一真相                          | 用户指出"两张皮"架构不干净 |
| 2026-04-24 | 放弃"stage 投影 task.status"方案，stage 直接消费+更新 task | 用户"标完成不等于真完成"   |
| 2026-04-24 | 必须做 SOTA，不做 Phase 1 修补                             | 用户明确要求               |
| 2026-04-24 | BullMQ on Redis 而非 Temporal                              | 已有基础设施，避免新依赖   |
| 2026-04-24 | Langfuse 为 primary OTel exporter                          | LLM trace 生态最完整       |
| 2026-04-24 | Feature flag + 灰度切换                                    | 避免生产大爆炸             |

---

## 17. 附录：对比参考实现

| 能力             | 参考                                     | 本方案对应                            |
| ---------------- | ---------------------------------------- | ------------------------------------- |
| ReAct loop       | ReAct 论文 / LangGraph agent             | ReActRunner                           |
| Checkpoint FSM   | Temporal / Inngest / Restate             | TaskCheckpointer                      |
| Function calling | OpenAI Assistants / Anthropic tool_use   | ToolRegistry                          |
| Multi-judge      | Constitutional AI / Self-RAG / Reflexion | SelfJudge + ExternalJudge + MetaJudge |
| Dynamic replan   | Microsoft Magentic-One Orchestrator      | DynamicReplanner                      |
| Cost-aware       | FrugalGPT / Portkey                      | BudgetAccountant                      |
| OTel trace       | OpenLLMetry / Langfuse                   | tracer + Langfuse exporter            |
| HITL             | Claude Projects / Cursor composer        | pause/edit/resume API                 |

---

**以上为权威方案。接下来 28 commit 严格遵循，中途不再回头讨价。每 commit 前 tsc+jest 全绿，每 phase 末尾生产 dry-run，Phase 7 达标才算结束。**
