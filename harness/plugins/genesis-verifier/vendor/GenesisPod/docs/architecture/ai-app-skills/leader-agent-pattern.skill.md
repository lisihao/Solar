---
name: leader-agent-pattern
description: |
  Leader-Agent orchestration pattern for AI App modules. Leader makes decisions (plan/review/chat),
  Agents execute tasks. Leader uses reasoning models, Agents use execution models.
  Use when: multi-agent orchestration, ai-planning, leader-design, agent-coordination.
version: "2.0.0"
domain: general
layer: planning
taskTypes:
  - leader-design
  - agent-coordination
  - multi-agent-orchestration
priority: 90
author: genesis-ai
source: local
tags:
  - leader
  - agent
  - orchestration
  - planning
  - review
  - best-practice
tokenBudget: 4000
executionMode: prompt
taskProfile:
  creativity: low
  outputLength: long
---

# Leader-Agent 编排模式 Skill

## 角色定位

你是 GenesisPod 平台的多 Agent 编排架构师，负责设计 Leader-Agent 协作模式。你深谙 Topic Insights 标杆模块中 ResearchLeaderService 验证过的最佳实践。ResearchLeaderService 已从单体拆分为 4 个子服务，Facade 本身保持 < 100 行。

## 核心原则

**Leader 不执行任务，只做决策。Leader 的三个职责且仅有三个：plan()、review()、chat()。**

Topic Insights 早期让 Leader 自己执行搜索/写作，后来拆分为"Leader 决策 + Agent 执行"后质量显著提升。

## Leader Service 设计

### 三个核心方法

```typescript
@Injectable()
export class LeaderService {
  constructor(
    private readonly chatFacade: ChatFacade,
    private readonly agentFacade: AgentFacade,
    private readonly toolFacade: ToolFacade,
  ) {}

  /**
   * 1. plan() — 输入上下文，输出任务分解
   *
   * Leader 使用推理模型分析任务，决定：
   * - 拆分为哪些子任务
   * - 每个子任务分配给哪个 Agent
   * - 每个 Agent 使用什么模型
   * - 每个 Agent 需要什么 Skills/Tools
   */
  async plan(context: PlanContext): Promise<MissionPlan> {
    // 1. 收集上下文
    const availableModels = await this.chatFacade.getAvailableModelsExtended();
    const availableTools = this.toolFacade.listEnabledTools();

    // 2. 构建规划 prompt
    const prompt = this.buildPlanPrompt(
      context,
      availableModels,
      availableTools,
    );

    // 3. 调用推理模型
    const response = await this.chatFacade.chat({
      messages: [
        { role: "system", content: LEADER_SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      taskProfile: {
        creativity: "medium", // 规划需要一定创造力
        outputLength: "extended", // 规划输出较长
      },
    });

    // 4. 解析 + 验证
    const plan = extractJsonFromAIResponse<MissionPlan>(response.content);

    // 5. 后处理：补全缺失的分配
    return this.postProcessPlan(plan, availableModels);
  }

  /**
   * 2. review() — 输入任务结果，输出通过/返工决策
   */
  async review(
    taskResult: TaskResult,
    reviewContext: ReviewContext,
  ): Promise<ReviewDecision> {
    const prompt = this.buildReviewPrompt(taskResult, reviewContext);

    const response = await this.chatFacade.chat({
      messages: [
        { role: "system", content: REVIEWER_SYSTEM_PROMPT },
        { role: "user", content: prompt },
      ],
      taskProfile: {
        creativity: "low", // 审核需要精确
        outputLength: "medium",
      },
    });

    return extractJsonFromAIResponse<ReviewDecision>(response.content);
  }

  /**
   * 3. chat() — 输入用户追问，输出策略调整
   */
  async chat(
    userMessage: string,
    missionContext: MissionContext,
  ): Promise<LeaderResponse> {
    // 理解用户意图，调整当前策略
    // 可能触发：添加任务、修改优先级、调整深度
  }
}
```

### Plan 输出结构

```typescript
interface MissionPlan {
  // Leader 对任务的理解
  taskUnderstanding: string;

  // 子任务列表 (按执行顺序)
  tasks: Array<{
    id: string;
    name: string;
    description: string;
    taskType: string; // "domain_task" | "quality_review" | "synthesis"
    priority: number; // 越高越优先
    dependencies: string[]; // 依赖的其他 task id
  }>;

  // Agent 分配
  agentAssignments: Array<{
    taskId: string;
    agentType: string; // "researcher" | "writer" | "reviewer"
    modelId: string; // AI 选择的模型
    skills: string[]; // 分配的 skills
    tools: string[]; // 分配的 tools
  }>;

  // 执行策略
  executionPlan: {
    maxConcurrent: number; // 最大并发数
    estimatedDuration: string; // 预估时长
    riskFactors: string[]; // 风险提示
  };
}
```

### Review 输出结构

```typescript
interface ReviewDecision {
  // 通过/返工/拒绝
  status: "approved" | "needs_revision" | "rejected";

  // 总体评分 (0-1)
  overallScore: number;

  // 分维度评分
  scores: {
    accuracy: number;
    completeness: number;
    depth: number;
    readability: number;
  };

  // 如果 needs_revision，具体反馈
  feedback?: Array<{
    taskId: string;
    issue: string;
    suggestion: string;
    severity: "critical" | "major" | "minor";
  }>;
}
```

## 模型选择策略

### Leader vs Agent 模型分配

| 角色          | 模型类型 | TaskProfile                                | 原因                   |
| ------------- | -------- | ------------------------------------------ | ---------------------- |
| Leader (规划) | 推理模型 | creativity: medium, outputLength: extended | 需要深度思考和全局视角 |
| Leader (审核) | 推理模型 | creativity: low, outputLength: medium      | 需要精确判断           |
| Agent (执行)  | 执行模型 | 按任务类型调整                             | 需要高效产出           |

### 模型分配由 AI 决定

```typescript
// Leader 的 plan() 输出中包含模型分配
// ★ 不硬编码模型名，由 Leader 从可用列表中选择

private postProcessPlan(
  plan: MissionPlan,
  availableModels: ModelInfo[],
): MissionPlan {
  for (const assignment of plan.agentAssignments) {
    if (!assignment.modelId) {
      // AI 没指定模型 → 轮询分配
      assignment.modelId = availableModels[i % availableModels.length].id;
    }

    // ★ 验证模型确实可用
    const modelExists = availableModels.some(m => m.id === assignment.modelId);
    if (!modelExists) {
      assignment.modelId = availableModels[0].id;  // fallback
    }
  }
  return plan;
}
```

## Leader 思考过程透传

Topic Insights 的关键创新：让用户看到 Leader 的思考过程。

```typescript
// 规划阶段，分步发射思考事件
async plan(context: PlanContext): Promise<MissionPlan> {
  // 阶段 1: 理解
  this.eventEmitter.emitLeaderThinking({
    phase: "understanding",
    content: "Analyzing the task requirements...",
    progress: 10,
  });

  // 阶段 2: 分析
  this.eventEmitter.emitLeaderThinking({
    phase: "analyzing",
    content: "Identifying key dimensions and data sources...",
    progress: 30,
  });

  // 阶段 3: 规划
  this.eventEmitter.emitLeaderThinking({
    phase: "planning",
    content: "Designing execution strategy...",
    progress: 60,
  });

  // 阶段 4: 分配
  this.eventEmitter.emitLeaderThinking({
    phase: "assigning",
    content: "Assigning agents and models...",
    progress: 90,
  });

  // 规划完成，等待用户审批（可选）
  this.eventEmitter.emitLeaderPlanReady(plan);
}
```

## 用户审批点 (PLAN_READY)

```
Leader 规划完成
     ↓
emit(PLAN_READY, plan)  → 推送到前端
     ↓
等待用户操作:
  ├── approve → startExecution()
  ├── modify  → adjustPlan() → 重新 emit(PLAN_READY)
  └── cancel  → cancelMission()
```

**什么时候需要审批？**

- 高成本任务（预估 Token 消耗大）
- 高风险任务（涉及外部 API 调用）
- 用户在设置中开启了"审批模式"
- 默认可自动跳过（直接 EXECUTING）

## Leader 与用户的对话 (chat)

```typescript
// 用户可以在 Mission 执行过程中与 Leader 对话
async chat(userMessage: string, context: MissionContext): Promise<LeaderResponse> {
  const response = await this.chatFacade.chat({
    messages: [
      { role: "system", content: LEADER_CHAT_PROMPT },
      ...context.conversationHistory,
      { role: "user", content: userMessage },
    ],
    taskProfile: { creativity: "medium", outputLength: "medium" },
  });

  // 解析 Leader 的回复，可能包含动作指令
  const parsed = this.parseLeaderResponse(response.content);

  if (parsed.actions?.addTasks) {
    await this.lifecycleService.addTasks(context.missionId, parsed.actions.addTasks);
  }
  if (parsed.actions?.adjustPriority) {
    await this.lifecycleService.adjustPriority(context.missionId, parsed.actions.adjustPriority);
  }

  return parsed;
}
```

## Agent 定义最佳实践

### Agent 只是元数据容器

```typescript
// ✅ 正确：Agent 声明能力，不含业务逻辑
@Injectable()
export class DomainAgent extends PlanBasedAgent {
  readonly id = "domain-agent";
  readonly capabilities = ["research", "analysis"];
  readonly requiredTools = [BUILTIN_TOOLS.WEB_SEARCH];

  async *execute(plan: AgentPlan): AsyncGenerator<AgentEvent> {
    // 委托给 Service 层
    yield { type: "complete", result: { summary: "Delegated" } };
  }
}

// ❌ 错误：Agent 包含业务逻辑
@Injectable()
export class DomainAgent extends PlanBasedAgent {
  async *execute(plan: AgentPlan): AsyncGenerator<AgentEvent> {
    // ❌ 不应该在这里调用 ChatFacade
    const result = await this.chatFacade.chat({...});
    // ❌ 不应该在这里操作数据库
    await this.prisma.report.create({...});
  }
}
```

### Agent 类型选择

| 场景                   | Agent 类型       | 原因                        |
| ---------------------- | ---------------- | --------------------------- |
| 需要自主规划的智能任务 | `PlanBasedAgent` | 声明 PlanStep[]，由框架调度 |
| 流程确定的执行任务     | `BaseAgent<I,O>` | 严格类型约束输入输出        |
| 纯工具调用             | 不需要 Agent     | 直接通过 ToolFacade 调用    |

## Reference Implementation：ResearchLeaderService 拆分

ResearchLeaderService 已从单体（1500+ 行）拆分为 thin facade + 4 个子服务：

```
ResearchLeaderService (thin facade, < 100 行)
  ├── LeaderPlanningService    — planResearch(), planDimensionOutline(), planGlobalOutline()
  ├── LeaderIntentService      — handleUserMessage(), decodeUserInput(), quickDecodeIntent()
  ├── LeaderAgentSelectionService — selectAgentForTask(), workload balancing
  └── LeaderReviewService      — reviewTaskResult(), extractClaims(), verifyHypotheses()
```

文件路径：

- `services/core/research-leader.service.ts` （Facade）
- `services/core/leader-planning.service.ts`
- `services/core/leader-intent.service.ts`
- `services/core/leader-agent-selection.service.ts`
- `services/core/leader-review.service.ts`

### Facade Decomposition 模式

当 Leader Service 行数超过 800 行时，按以下维度拆分：

| 子服务                      | 职责                                      |
| --------------------------- | ----------------------------------------- |
| LeaderPlanningService       | 所有规划类 LLM 调用（研究规划、大纲生成） |
| LeaderIntentService         | 用户意图解析（对话、指令解码）            |
| LeaderAgentSelectionService | Agent 选择与负载均衡（不调 LLM）          |
| LeaderReviewService         | 任务结果审核、主张提取、假设验证          |

Facade 只保留跨子服务的编排方法和对外公开的接口，不含业务逻辑。

## 禁忌

1. **禁止让 Leader 执行任务** -- Leader 只做 plan/review/chat 三件事
2. **禁止硬编码模型名** -- 由 Leader 从可用列表中选择，或使用 TaskProfile
3. **禁止在 Agent 中写业务逻辑** -- Agent 是元数据容器，业务在 Service
4. **禁止跳过规划阶段** -- 即使简单任务也要经过 Leader plan()
5. **禁止静默审核** -- 审核结果必须记录（LeaderDecision 表），可追溯

{{#if orchestrationContext}}

## 编排上下文

{{{orchestrationContext}}}
{{/if}}
