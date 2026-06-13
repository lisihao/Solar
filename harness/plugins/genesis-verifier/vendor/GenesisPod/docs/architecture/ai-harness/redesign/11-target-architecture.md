# 11 · 目标架构 · 单 Harness + 环境感知

> 版本：v2 · 2026-04-23
> 状态：**目标架构（理想标杆）**，不存在"过渡妥协版本"
> 立场：本文描述**唯一终态**，任何阶段性代码若与本文不符，都是技术债，必须在配套迁移 PR 内清除。

---

## 一、唯一立场

```
系统只有一个 Agent 运行时 = L2 ai-engine/harness/
系统只有一个 Agent 注册表 = L2 ai-engine/agents/registry/AgentRegistry
系统只有一个环境感知入口 = L2 ai-engine/runtime/resource/RuntimeEnvironmentService
```

**L3 AI App 不自造 Agent 运行时、不自造 Agent Registry、不自造 BaseAgentRunner**。L3 只：

1. 写 Agent 的 **声明式 spec**（role / goal / tools / skills / modelProfile / outputSchema / promptBuilder）
2. 在 `onModuleInit` 用 L2 `AgentFactory.create(spec)` 构造 agent 并注册到 **L2** `AgentRegistry`
3. 自己的 Pipeline / 业务编排器通过 `l2.agentRegistry.get(id).execute(...)` 调用

---

## 二、目标目录结构

```
backend/src/modules/
├── ai-engine/
│   ├── harness/                          ← 唯一 Agent 运行时
│   │   ├── abstractions/                 IAgent / IAgentSpec / ISkill / ITool / IContextEnvelope / IHook
│   │   ├── core/                         AgentFactory / AgentIdentity / HarnessedAgent / HookRegistry / CheckpointStore
│   │   ├── executor/                     ReActLoop / LlmExecutor（含 Zod 校验 + error-fed retry + forbiddenTools 强校验）
│   │   ├── facade/                       HarnessFacade
│   │   ├── memory-bridge/                MemoryBridge (可选)
│   │   ├── skills/                       SkillLoader / SkillRegistry / SkillActivator
│   │   ├── subagent/                     SubagentSpawner
│   │   └── context/                      Compactor / Manager
│   │
│   ├── agents/
│   │   └── registry/AgentRegistry        ← 唯一全系统 Agent 注册表
│   │
│   ├── tools/registry/ToolRegistry       ← 唯一全系统 Tool 注册表
│   ├── skills/registry/SkillRegistry     ← 唯一全系统 Skill 注册表
│   │
│   ├── llm/                              AiChatService / ModelFallbackService / SystemModelInventoryService / ...
│   │
│   ├── runtime/resource/
│   │   ├── RuntimeEnvironmentService     ← 唯一环境感知入口
│   │   ├── HealthCheckRunner             周期健康探测
│   │   ├── TokenBudgetService / CircuitBreaker / CostController / RateLimiter
│   │   └── ...
│   │
│   └── facade/                           对 L3 统一导出
│
└── ai-app/topic-insights/                ← L3 纯业务，零 Agent 运行时代码
    ├── topic-insights.module.ts          onModuleInit 遍历 spec → L2 AgentFactory.create → L2 registry.register
    │
    ├── agents-spec/                      ★ 17 份声明式 spec（不是执行代码）
    │   ├── leader-planner.spec.ts
    │   ├── section-writer.spec.ts
    │   ├── section-reviewer.spec.ts
    │   ├── meta-extractor.spec.ts
    │   ├── quality-reviewer.spec.ts
    │   ├── synthesizer.spec.ts
    │   ├── dimension-planner.spec.ts
    │   ├── fact-checker.spec.ts
    │   ├── gap-searcher.spec.ts
    │   ├── hypothesis-verifier.spec.ts
    │   ├── fact-extractor.spec.ts
    │   ├── section-remediator.spec.ts
    │   ├── report-evaluator.spec.ts
    │   ├── report-editor.spec.ts
    │   ├── latex-repair.spec.ts
    │   ├── mission-adjuster.spec.ts
    │   ├── leader-dispatcher.spec.ts
    │   └── index.ts → TOPIC_INSIGHTS_AGENT_SPECS: IAgentSpec[]
    │
    ├── pipeline/                         Topic Insights 专属编排（保留）
    │   ├── pipeline-orchestrator.service.ts
    │   ├── stage-registry.ts
    │   ├── stages/                       15 个 Stage
    │   └── types/{identity-context, budget, stage, stage-results, ...}
    │
    ├── capability/
    │   └── topic-insights-capability-reconciler.ts  ← 仅依赖 L2 RuntimeEnvironmentService
    │
    ├── rollout/                          灰度/监控（非流量切换，是 SLO 观察 + DB 指标）
    │   ├── rollout.service.ts            recordRun + getHealthSnapshot + getHistorySnapshot
    │   └── rollout-health.controller.ts  /topic-insights/health /capabilities /history
    │
    ├── intent/                           AG-17-LDP 消费者封装（对外 HTTP 接口）
    │   └── dispatcher.service.ts + dispatcher.controller.ts
    │
    ├── services/                         mission-execution / dimension / report / ...
    ├── controllers/                      HTTP/WebSocket 入口
    └── types/                            domain 类型
```

**不存在于目标架构的目录**：

- `ai-app/topic-insights/harness/` —— **整个子目录删除**
- `ai-app/topic-insights/harness/agents/*.agent.ts` —— 17 个执行文件全删（迁成 spec）
- `ai-app/topic-insights/harness/agents/base-agent-runner.ts` —— 删除
- `ai-app/topic-insights/harness/agents/agent-registry.ts` (HarnessAgentRegistry) —— 删除
- `ai-app/topic-insights/harness/llm/llm-invoker.service.ts` —— 能力上提到 L2 `LlmExecutor`
- feature flags：`TOPIC_INSIGHTS_USE_HARNESS` / `TOPIC_INSIGHTS_HARNESS_ROLLOUT_PCT` / `HARNESS_AGENTS_STUB` —— 全删

---

## 三、L2 承载 17 Agent 需要补的能力（Phase 2 清单）

当前 L2 `IAgent.execute()` 返回 `AsyncIterable<IAgentEvent>`（流式事件），不是 Zod 校验后的 typed output。L3 的 17 个 agent 依赖以下能力，L2 必须原生支持：

| 能力                                                                    | 当前 L2 状态                            | 需要补的内容                                                                                                                                                                   |
| ----------------------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Zod output schema 校验                                                  | 无                                      | `IAgentSpec.outputSchema?: z.ZodType<TOutput>`；`LlmExecutor` 收到 LLM raw output 后走 Zod parse，失败则 retry                                                                 |
| Error-fed retry（失败原因反喂下一轮 prompt）                            | 无                                      | `LlmExecutor` 内建循环，把 `ZodError.issues` / business-rule error 作为 system note 加入下一轮 prompt                                                                          |
| 类型化 output（非 `string \| Record`）                                  | 仅 `string \| Record<string, unknown>`  | 泛型化 `IAgentSpec<TInput, TOutput>` 与 `IAgent<TInput, TOutput>`，`execute(task: IAgentTask<TInput>): Promise<IAgentResult<TOutput>>`（流事件保留，但 final result 是强类型） |
| `forbiddenTools` 白名单                                                 | 仅 `tools`                              | `IAgentIdentity.forbiddenTools?: ToolRef[]`；ToolInvoker 调用时强校验，违反抛 `AgentAccessDeniedError`                                                                         |
| `TaskProfile`（creativity/outputLength → temperature/maxTokens）        | 无直接映射                              | `IAgentSpec.taskProfile?`；ReActLoop → LlmExecutor 转 provider params                                                                                                          |
| `BaselineRecorder` 观察者（KernelContext.missionId / baselineTag 透传） | 无                                      | L2 执行 LLM 前读 KernelContext，把 missionId 透给 AiChatService observer                                                                                                       |
| PipelineBudget 联动                                                     | 内建 IBudgetSnapshot，非 PipelineBudget | AgentFactory 接受可选 external budget，执行时 charge tokens/cost 到 external 对象                                                                                              |
| Stub 模式（测试零 LLM）                                                 | 无                                      | `IAgentSpec.stubFn?` 或 L2 env `AI_ENGINE_AGENT_STUB=1` 全局绕过 LLM；Spec 声明 stub 产出                                                                                      |
| Business-rule validation hook                                           | 无                                      | `IAgentSpec.validateBusinessRules?(output, ctx): void` throw 则触发同 Zod 失败的 retry                                                                                         |

**Phase 2 PR 清单：** 每一项能力一个独立 PR，最后一个 PR 整体接通并迁移 17 agent。详见 [12-target-migration-plan.md](./12-target-migration-plan.md)。

---

## 四、环境感知终态

### L2 `RuntimeEnvironmentService`

```typescript
// ai-engine/runtime/resource/runtime-environment.service.ts
@Injectable()
export class RuntimeEnvironmentService {
  constructor(
    private readonly prisma: PrismaService, // 必选
    private readonly agentRegistry: AgentRegistry, // 必选（L2 唯一表）
    private readonly toolRegistry: ToolRegistry, // 必选
    private readonly skillRegistry: SkillRegistry, // 必选
    @Optional() private readonly keyResolver?: KeyResolverService, // 可选（BYOK 场景）
  ) {}

  async snapshot(params: {
    userId: string;
    force?: boolean;
  }): Promise<EnvironmentSnapshot>;
  async tablesExist(names: string[]): Promise<Record<string, boolean>>;
  invalidate(userId?: string): void;
}
```

**必选依赖**（不再 @Optional）：目标架构下这 4 个 registry/service 必然在。Optional 只用于 Discovery 本身可降级的外部依赖（BYOK）。

### L3 `TopicInsightsCapabilityReconciler`

```typescript
// ai-app/topic-insights/capability/topic-insights-capability-reconciler.ts
@Injectable()
export class TopicInsightsCapabilityReconciler {
  constructor(
    private readonly runtimeEnv: RuntimeEnvironmentService, // ← 仅此一个依赖
  ) {}

  async reconcile(params: {
    userId: string;
    requestedDepth: ResearchDepth;
  }): Promise<TopicInsightsCapabilitySnapshot>;
}
```

**没有** `HarnessAgentRegistry` 注入 —— 因为 17 agent 注册到了 L2，`env.agents` 里自然有。

`TopicInsightsCapabilitySnapshot` 结构：

```typescript
interface TopicInsightsCapabilitySnapshot {
  readonly env: EnvironmentSnapshot; // L2 原样
  readonly topicInsights: {
    readonly requiredTablesPresent: Record<string, boolean>;
    readonly missingCoreAgents: string[];
    readonly missingEnhancementAgents: string[];
    readonly missingAdvancedAgents: string[];
  };
  readonly recommendedDepth: ResearchDepth;
  readonly requestedDepth: ResearchDepth;
  readonly degradations: TopicInsightsDegradation[];
}
```

---

## 五、Leader（AG-01-LD）契约

**输入**：`LeaderPlannerInput` 接收 `capabilities: TopicInsightsCapabilitySnapshot` 整体（不再是离散的 availableModels 数组）。

**Prompt 展开规则**：system prompt 自动从 `capabilities.env.models` / `capabilities.env.tools` 生成"可用资源清单"段落。

**Output schema business-rule 校验**：

```typescript
// ai-app/topic-insights/agents-spec/leader-planner.spec.ts
validateBusinessRules: (plan: LeaderPlan, ctx) => {
  const caps = ctx.input.capabilities;
  const validModelIds = new Set([
    "",
    ...caps.env.models.CHAT.map((m) => m.modelId),
    ...caps.env.models.REASONING.map((m) => m.modelId),
  ]);
  for (const a of plan.agentAssignments) {
    if (!validModelIds.has(a.modelId)) {
      throw new BusinessRuleError(
        `agentAssignment.modelId "${a.modelId}" not in capabilities`,
      );
    }
  }
};
```

**不通过 → L2 `LlmExecutor` error-fed retry**（最多 3 轮），error reason 反喂到下一轮 prompt。

---

## 六、Mission 执行单路径

**没有 `runWithHarness` / `runLegacy` 分叉**。`mission-execution.startExecution` 只有一条路：

```typescript
async startExecution(missionId, topicId) {
  // 1. 取 mission + topic
  // 2. 调 reconciler 算 capabilities
  const caps = await this.reconciler.reconcile({ userId, requestedDepth });
  if (caps.degradations.some(d => d.severity === "error")) {
    return this.failMission(missionId, caps.degradations);
  }
  // 3. 构造 identity context，注入 capabilities
  const identity = buildIdentityContext({ ..., depth: caps.recommendedDepth, capabilities: caps });
  // 4. 跑 pipeline
  await this.pipelineOrchestrator.run(identity);
}
```

**没有** `TOPIC_INSIGHTS_USE_HARNESS` 读取。**没有** `HarnessRolloutService.shouldUseHarness` 分流。**没有** `runLegacyDynamicScheduler`。

---

## 七、关于 `HarnessRolloutService` 的定位

目标架构下保留，但**不再做流量切换**：

- 保留的职责：
  - `recordRun(metric)` 记录每次 mission 的 success/duration/qualityScore/tokens/cost
  - `getHealthSnapshot()` / `getHistorySnapshot(hours)` 提供给监控面板
  - auto-rollback 逻辑**改为"auto-alert"**：连续失败率超阈值只触发告警（SSE/Slack），不改变执行路径
- 删除的职责：
  - `shouldUseHarness(userId)` → 删除（目标架构无分流）
  - 与 `TOPIC_INSIGHTS_*` env 的任何依赖 → 删除
- 改名建议：`HarnessRolloutService` → `TopicInsightsMissionMetricsService`（后续 PR 改名，不强制本 PR）

---

## 八、文档体系调整

| 文档                        | 现状                              | 目标                                                           |
| --------------------------- | --------------------------------- | -------------------------------------------------------------- |
| 00-overview.md              | 描述"harness 重构"                | 改写：目标架构总纲                                             |
| 02-target-architecture.md   | v2.1 含"capabilities 补丁"章节    | 改写：单 harness 架构图                                        |
| 03-harness-agents-design.md | 假定 L3 自写 BaseAgentRunner      | 改写：17 agent spec 化                                         |
| 04-pipeline-orchestrator.md | ST-00 自拉 availableModels        | 改写：ST-00 从 identity.capabilities 读                        |
| 07-implementation-plan.md   | 按 Tier Core/Enhancement/Advanced | 改写：按"L2 补能力 → L3 spec 化 → 删 L3 harness/ → 上线"三阶段 |
| 09-data-contracts.md        | availableModels: string[]         | 改写：capabilities: TopicInsightsCapabilitySnapshot            |
| 11                          | 原"capability-discovery"          | **本文档**（目标架构）                                         |
| 12                          | 不存在                            | **新增** target-migration-plan                                 |
| 10-review-and-gaps.md       | 保留                              | 保留                                                           |

Doc 改写与代码迁移同步完成。

---

## 九、验收标准（上线到 Topic Insights 打样）

不满足以下任一项，本项目不视为完成：

- [ ] 生产 `git grep -r "HarnessAgentRegistry\|BaseAgentRunner\|runWithHarness\|TOPIC_INSIGHTS_USE_HARNESS" backend/src` 零匹配
- [ ] `ai-app/topic-insights/harness/` 目录在 main 不存在
- [ ] Railway 生产环境无 `TOPIC_INSIGHTS_USE_HARNESS` / `TOPIC_INSIGHTS_HARNESS_ROLLOUT_PCT` / `HARNESS_AGENTS_STUB` 变量
- [ ] L2 `AgentRegistry.getAllIds()` 查询 → 返回包含 AG-01-LD ... AG-17-LDP 全部 17 个 id
- [ ] 生产跑一次 `thorough` depth mission → 17 agent × 15 stage 完整执行 → report 写入 `topic_report` 表 → 前端正确显示
- [ ] `GET /api/v1/topic-insights/capabilities?userId=xxx` 返回非空 `env.agents` 包含 17 id
- [ ] `git revert HEAD` 一次 → 可回滚到 commit 前状态（没有"半完成"挂尸）

---

**Changelog**

- v2 · 2026-04-23 · 响应"不接受妥协"原则，彻底重写为单 harness 目标架构
- v1 · 2026-04-23 · 首版（含两 harness 并存描述）— 已作废，见本文 v2
