# 12 · 目标架构迁移计划

> 版本：v1 · 2026-04-23  
> 目标：**从"两 harness 并存 / L3 自造 Agent 运行时"的当前状态，迁到"L2 单 harness / L3 仅 spec"的目标架构**（见 [11-target-architecture.md](./11-target-architecture.md)）。  
> 原则：每个 PR 都保持 main 可用（测试绿、mission 能跑）；失败则 `git revert` 回到上一个 PR，不做 feature flag 兜底。

---

## 一、阶段划分

```
P0 · 架构对齐（文档 + 清理临时品）
  ├── P0-1  doc 11 + doc 12 定稿，02/03/04/07/09 同步改写
  └── P0-2  revert 本 session 临时产物，clean commit 到 main

P1 · L2 能力补齐（扩展 ai-engine/harness 承载 17 agent 所需）
  ├── P1-1  IAgentSpec 泛型化 + outputSchema + validateBusinessRules
  ├── P1-2  LlmExecutor Zod 校验 + error-fed retry
  ├── P1-3  forbiddenTools + taskProfile + KernelContext passthrough
  ├── P1-4  external PipelineBudget 挂接 + stub 模式
  └── P1-5  RuntimeEnvironmentService 强依赖 + SkillRegistry 注入

P2 · L3 spec 化（17 agent 迁成声明式）
  ├── P2-1  agents-spec/ 17 份 spec 文件
  └── P2-2  topic-insights.module 遍历 spec → L2 AgentFactory/Registry 注册

P3 · 删 L3 harness/ 目录
  ├── P3-1  pipeline/stages/utils/rollout 搬出 harness/ → topic-insights/ 平级
  ├── P3-2  删 harness/{agents, llm, harness.module.ts, index.ts}
  └── P3-3  mission-execution 单路径，删 env flag 读取

P4 · 环境感知接通
  ├── P4-1  TopicInsightsCapabilityReconciler（新位置，仅依赖 L2 RuntimeEnvironmentService）
  ├── P4-2  PipelineIdentityContext.capabilities required，ST-00/stages 从此字段读
  └── P4-3  Leader spec capability-aware + `/api/v1/topic-insights/capabilities` endpoint

P5 · 测试 + 上线
  ├── P5-1  测试覆盖（L2 单元 + L3 集成 + 回归 5593）
  └── P5-2  commit chain + push + Railway redeploy + 删 env 变量 + prod smoke
```

---

## 二、每个 PR 的 Acceptance（必须逐项过）

### P0-1 · 文档定稿

- [ ] `docs/design/topic-insights-harness-redesign/11-target-architecture.md` 不含"两 harness 并存"描述
- [ ] `docs/design/topic-insights-harness-redesign/12-target-migration-plan.md` 成文
- [ ] `00/02/03/04/07/09` 移除"HarnessAgentRegistry / BaseAgentRunner / LlmInvokerService" 术语（或明确标"过渡期产物"）
- [ ] 删除 doc 11 v1 残留（已用 v2 覆盖）

### P0-2 · 清理临时品

- [ ] `ai-app/topic-insights/harness/capability/` 目录不存在 ✅ 已删
- [ ] `PipelineIdentityContext.capabilities?` 字段已 revert ✅ 已 revert
- [ ] `harness/harness.module.ts` 无 `HarnessCapabilityReconciler` provider ✅ 已 revert
- [ ] `mission-execution.service.ts` 无 `harnessCapabilityReconciler` 注入 ✅ 已 revert
- [ ] 保留：`StartupMigrationService.ensureHarnessRunMetricsTable`（纯止血，目标架构仍需）
- [ ] 保留：L2 `RuntimeEnvironmentService` + `RuntimeResourceModule` 注册 + facade export（目标架构组成部分）
- [ ] `npx tsc --noEmit` 绿；`jest topic-insights` 5593 绿
- [ ] commit：`chore(topic-insights): align to target architecture (doc 11/12) + revert intermediate capability patches`
- [ ] push main

### P1-1 · IAgentSpec 泛型

- [ ] `IAgentSpec<TInput = unknown, TOutput = unknown>` 泛型化
- [ ] 加可选字段：`outputSchema?: z.ZodType<TOutput>` `validateBusinessRules?(output, ctx): void`
- [ ] `IAgent<TInput, TOutput>` / `IAgentResult<TOutput>` 同步
- [ ] 向后兼容：不传 schema = 现有行为
- [ ] 单元：schema-valid output 原样；schema-invalid 触发 throw
- [ ] 所有 L2 harness 测试绿（读当前 test 统计补数）

### P1-2 · Zod + error-fed retry

- [ ] `LlmExecutor`（L2 harness/executor/）：收到 LLM raw text → outputSchema.safeParse → 失败则 next prompt 加 system note "Your last output failed validation: <zod issues>. Retry."
- [ ] 最多 3 轮；超限抛 `SchemaRetryExhaustedError`
- [ ] 复用现有 `LlmInvokerService` 的 JSON 提取逻辑（或抽出 util）
- [ ] 单元：retry 路径 / 超限路径 / 一次过路径

### P1-3 · forbiddenTools + taskProfile + KernelContext

- [ ] `IAgentIdentity.forbiddenTools?: ToolRef[]`
- [ ] ToolInvoker 执行前检查，命中则抛 `AgentAccessDeniedError`
- [ ] `IAgentSpec.taskProfile?` 传给 LlmExecutor → AiChatService
- [ ] L2 执行 LLM 前读 `KernelContext.get()` 取 `missionId` / `baselineTag`，作为 call options 透给 AiChatService（BaselineRecorder observer 能收到）

### P1-4 · 外部 Budget + Stub

- [ ] `AgentFactory.create(spec, { externalBudget?: PipelineBudget })` 支持外部 budget
- [ ] 执行后 charge tokens/cost 到 externalBudget（若提供）
- [ ] `IAgentSpec.stubFn?(task): Promise<TOutput>` 或环境变量 `AI_ENGINE_AGENT_STUB=1`
- [ ] stub 生效时绕过 LLM，产出必须过 outputSchema 校验（保证稳定）

### P1-5 · RuntimeEnvironmentService 强依赖

- [ ] `PrismaService + AgentRegistry + ToolRegistry + SkillRegistry` 必选注入（去掉 @Optional）
- [ ] `RuntimeResourceModule` import `AiEngineOrchestrationModule`（或等价）让这三个 registry 在同一 DI 作用域
- [ ] `KeyResolverService` @Optional（BYOK 可选）
- [ ] `snapshot().agents` / `tools` / `skills` 不再为空
- [ ] 单元：L2 各 registry 空 vs 非空 → snapshot 正确反映

### P2-1 · 17 spec 文件

- [ ] `ai-app/topic-insights/agents-spec/` 17 份 `.spec.ts`
- [ ] 每份包含：role(id/name/description) / goal.summary / tools / forbiddenTools / skills / taskProfile / outputSchema (Zod，从现 harness/agents/schemas.ts 迁) / validateBusinessRules / systemPromptBuilder / userPromptBuilder / stubFn
- [ ] `index.ts` 导出 `TOPIC_INSIGHTS_AGENT_SPECS: IAgentSpec[]`
- [ ] 单元：每个 spec 的 stubFn 产出通过 outputSchema 校验

### P2-2 · 注册到 L2

- [ ] `topic-insights.module.ts` onModuleInit 遍历 `TOPIC_INSIGHTS_AGENT_SPECS`
- [ ] 对每份 spec 调 `l2.agentFactory.create(spec)` 构造 IAgent
- [ ] 对每个 IAgent 调 `l2.agentRegistry.register(agent)`
- [ ] Pipeline stages（现 harness/stages/\*）替换 `harnessAgentRegistry.get(id)` → `l2.agentRegistry.get(id).execute(task)`
- [ ] 回归：`jest topic-insights` 绿，stub 模式 mission 能跑完 17 agent
- [ ] 此 PR 后：L2 `agentRegistry.getAllIds()` 包含 `AG-01-LD ... AG-17-LDP` 17 个

### P3-1 · 目录重组

- [ ] `harness/pipeline/` → `topic-insights/pipeline/`
- [ ] `harness/stages/` → `topic-insights/pipeline/stages/`
- [ ] `harness/utils/` → `topic-insights/pipeline/utils/`
- [ ] `harness/rollout/` → `topic-insights/rollout/`（改名 controller 路由 `/harness/*` → `/topic-insights/*`）
- [ ] 所有 import 路径更新
- [ ] 回归绿

### P3-2 · 删 L3 harness/

- [ ] 删 `harness/agents/*.agent.ts` (17)
- [ ] 删 `harness/agents/base-agent-runner.ts`
- [ ] 删 `harness/agents/agent-registry.ts` (HarnessAgentRegistry)
- [ ] 删 `harness/agents/schemas.ts`（内容已迁到 spec）
- [ ] 删 `harness/llm/`
- [ ] 删 `harness/harness.module.ts` / `harness/index.ts`
- [ ] `rmdir harness/`
- [ ] 搜索 `grep -r "HarnessAgentRegistry\|BaseAgentRunner\|LlmInvokerService\|topic-insights/harness" backend/src` 零匹配

### P3-3 · Mission 单路径

- [ ] `mission-execution.service.ts` 删 `harnessFlagOn` / `shouldUseHarness` / `runWithHarness` / `runLegacyDynamicScheduler` 分叉
- [ ] 单一路径：`startExecution` → reconciler → pipeline
- [ ] 删 `HarnessRolloutService.shouldUseHarness()`
- [ ] 删 `process.env.TOPIC_INSIGHTS_USE_HARNESS` / `TOPIC_INSIGHTS_HARNESS_ROLLOUT_PCT` / `HARNESS_AGENTS_STUB` 所有读取
- [ ] 搜索这三个 env 名在 backend/src 零匹配

### P4-1 · 新 Reconciler

- [ ] `ai-app/topic-insights/capability/topic-insights-capability-reconciler.ts`
- [ ] 注入：`RuntimeEnvironmentService`（唯一依赖）
- [ ] 实现：`reconcile({userId, requestedDepth})` → `TopicInsightsCapabilitySnapshot`
- [ ] 校验：17 agent id 都在 env.agents；tablesExist(relevant tables)；CHAT model 非空；key 可用
- [ ] 算 recommendedDepth + degradations
- [ ] 单元：各 degradation 路径

### P4-2 · IdentityContext

- [ ] `PipelineIdentityContext.capabilities: TopicInsightsCapabilitySnapshot`（必选）
- [ ] `buildIdentityContext` 参数加 `capabilities`（必选）
- [ ] ST-00-INIT + Leader + 其它 stage 从 `identity.capabilities.env` 读模型/工具

### P4-3 · Leader 能力感知 + HTTP

- [ ] `leader-planner.spec.ts` `systemPromptBuilder` 展开 capabilities.env 的模型/工具/agent 清单
- [ ] `validateBusinessRules` 校验 `agentAssignment.modelId ∈ capabilities.env.models.*`
- [ ] `GET /api/v1/topic-insights/capabilities` JWT-guarded 返回 snapshot
- [ ] 手工验：`curl /capabilities` 返回 `env.agents` 含 17 id

### P5-1 · 测试

- [ ] L2 单元：executor Zod retry / forbiddenTools / stub / KernelContext / budget
- [ ] L2 单元：RuntimeEnvironmentService 完整 snapshot
- [ ] L3 单元：TopicInsightsCapabilityReconciler 各 degradation 路径
- [ ] 集成：端到端 pipeline 跑完 17 agent 15 stage（mock LLM）
- [ ] 回归：所有既有测试 5593 绿

### P5-2 · 上线

- [ ] 所有 commit push main，Railway auto-deploy
- [ ] `railway variables --remove TOPIC_INSIGHTS_USE_HARNESS TOPIC_INSIGHTS_HARNESS_ROLLOUT_PCT HARNESS_AGENTS_STUB --service backend`
- [ ] Railway redeploy（需新容器读无 flag 环境）
- [ ] `curl https://api.gens.team/api/v1/topic-insights/capabilities -H "Authorization: Bearer ..."` 返回 200 + 非空 agents
- [ ] 用任意账号触发 thorough depth mission → 日志 `[PipelineOrchestratorService] mission=... completed stages=N` 看到 15 stage 全跑 → report 前端可见
- [ ] `git grep` 事后审计：无 `TOPIC_INSIGHTS_USE_HARNESS`、无 `HarnessAgentRegistry`、无 `BaseAgentRunner`、无 `topic-insights/harness/`

---

## 三、失败回滚策略

**不做 feature flag 兜底**。任何 PR 上线后：

- 测试回归失败 → `git revert <commit>` 推 main → Railway 自动 rollback
- 生产 mission 失败 → 同上
- 灾难级（DB schema 迁移错、API breaking）→ 保留快照 + 单独 hotfix PR 修复

每个 P 阶段 PR 独立可 revert，不跨 P 阶段共享状态。

---

## 四、时间估算

| Phase    | 工作量      | 备注                              |
| -------- | ----------- | --------------------------------- |
| P0       | 0.5 天      | 文档 + revert                     |
| P1       | 3-5 天      | L2 能力补齐，每项独立测试         |
| P2       | 2-3 天      | 17 spec 文件 + 注册逻辑           |
| P3       | 1 天        | 目录重组 + 删除（类型检查推着走） |
| P4       | 1 天        | 单路径 + reconciler + Leader      |
| P5       | 0.5 天      | 测试回归 + 上线冒烟               |
| **总计** | **8-11 天** | 单人专注；失败回滚不重置计数      |

---

## 五、本次提交（P0-2）包含

- ✅ **保留**：
  - `backend/src/common/prisma/startup-migration.service.ts` (harness_run_metrics self-heal)
  - `backend/src/modules/ai-engine/runtime/resource/runtime-environment.{service,types}.ts` + index.ts + resource.module.ts + facade export
  - `docs/design/topic-insights-harness-redesign/11-target-architecture.md`（v2 内容）
  - `docs/design/topic-insights-harness-redesign/12-target-migration-plan.md`（本文件）
- ✅ **revert**：
  - 删 `ai-app/topic-insights/harness/capability/` 目录 ✓
  - `harness/pipeline/types/identity-context.ts` 移除 `capabilities?` ✓
  - `harness/pipeline/pipeline-orchestrator.service.ts` 移除 buildIdentityContext 的 capabilities 参数 ✓
  - `harness/harness.module.ts` 移除 HarnessCapabilityReconciler provider/export ✓
  - `services/core/mission/mission-execution.service.ts` 移除 harnessCapabilityReconciler 注入 ✓
- **待**：
  - 更新 doc 00/02/03/04/07/09 — 引用本文档，标注旧架构描述"deprecated，见 11 v2"
  - 一次 clean commit + push

---

**Changelog**

- v1 · 2026-04-23 · 成文；替代 11 v1 的"两 harness 并存"叙述；作为 P0..P5 执行总纲
