# Model Election · 环境感知选举

> 2026-04-24 引入。取代 AiChatService 的 `DEFAULT_AI_MODEL` env 硬兜底，
> 让 harness spec agent 的模型选择基于运行时感知 + TaskProfile + role 多维打分。

## 问题

### 生产事故

```
[AG-01-LD] attempt 1/3 chat failed:
AI 服务不可用：DEFAULT_AI_MODEL 未设置且未指定 modelType/modelId。
```

Railway 没配 `DEFAULT_AI_MODEL` env，LlmExecutor 调 `aiChatService.chat({ taskProfile })`
不带 `model` 也不带 `modelType`，AiChatService.chat 的 else 分支直接抛错。

### 根因（设计层面，不是配置层面）

1. **感知已发生**：`RuntimeEnvironmentService.snapshot()` + `TopicInsightsCapabilityReconciler`
   已经把 `capabilities.env.models.CHAT[]` / `REASONING[]` 放进 `PipelineIdentityContext`
2. **选举缺失**：从候选池挑出"本次调用用哪个 modelId"的逻辑**没有模块**
3. **硬兜底错位**：让 LLM 层（AiChatService）兜底意味着它要重做它本不该知道的业务决策（role / tier / cost）

## 方案：三层职责分离

| 层             | 输入               | 输出                  | 职责             |
| -------------- | ------------------ | --------------------- | ---------------- |
| Runtime 感知   | DB + registry      | `EnvironmentSnapshot` | 列出"**有什么**" |
| Model Election | snapshot + request | `modelId`             | 决定"**用哪个**" |
| AiChatService  | modelId + messages | LLM 响应              | 执行调用         |

Election 不读 DB（除 candidates 为空时的纯 fallback），不管密钥，不重试——
**单一职责：打分排序**。

## 数据流

```
Pipeline Stage (e.g. ST-01-PLAN)
  │
  │  identity.capabilities.env  (by Reconciler in ST-00-INIT)
  ▼
SpecAgentRegistry.get("AG-01-LD").executeSpec(input, env)
  │
  ▼
SpecBasedAgent.executeSpec
  │
  │  role = roleHint(spec.identity.role.id)     # leader/writer/extractor/...
  │  candidates = env.models.CHAT + env.models.REASONING
  │  taskProfile = spec.taskProfile
  ▼
ModelElectionService.elect({
  modelType, candidates, taskProfile, role, userId, costBias
})
  │
  ├─ Step 1 · 硬过滤   (type 兼容 + healthy + blacklist)
  ├─ Step 2 · BYOK 过滤 (KeyResolverService.getAvailableProviders)
  ├─ Step 3 · 查 DB config（每个候选）
  ├─ Step 4 · 打分
  │    · tier      (match=25, neighbor=10, far=0)
  │    · role      (leader+reasoning=20, writer+STRONG=15, ...)
  │    · cost      (cheap/balanced/quality × cheap/standard/premium)
  │    · health    (errorRate 0→20, 0.1→10, 0.3→0)
  │    · priority  (priority/10)
  │    · isDefault (+5)
  └─ Step 5 · tie-break: priority DESC → isDefault → lex order
  │
  ▼  elected modelId
  │
LlmExecutor.execute({ model: elected, taskProfile, ... })
  │
  ▼
AiChatService.chat({ model, taskProfile, ... })      ← 带显式 model，不走 else
```

## 打分规则（v1）

### Tier 匹配（`scoreTier`）

Target tier 由 TaskProfile 决定：

- `creativity=high|medium ∧ outputLength=long|extended` → `STRONG`
- `creativity=deterministic ∧ outputLength=minimal` → `BASIC`
- 其他 → role fallback → `STANDARD`

打分：

- 命中 target → **25**
- 相邻 tier (STRONG↔STANDARD, STANDARD↔BASIC) → **10**
- 更远 → **0**

### Role 偏好（`scoreRole`）

| RoleHint                   | 规则                                 |
| -------------------------- | ------------------------------------ |
| `leader`                   | isReasoning=true → +20；STRONG → +10 |
| `writer` / `reviewer`      | STRONG → +15；STANDARD → +5          |
| `extractor` / `classifier` | BASIC → +10；STANDARD → +5           |
| `default`                  | 0                                    |

`resolveRoleHint()` 从 `spec.identity.role.id` 正则推断：

- `/leader|planner|dispatch|adjust/` → leader
- `/writer|section|synthes|editor|report/` → writer
- `/review|evaluat|check|verif|repair/` → reviewer
- `/extract|miner|meta/` → extractor
- `/classif|intent/` → classifier

### Cost bias（`scoreCost`）

| bias     | cheap  | standard | premium |
| -------- | ------ | -------- | ------- |
| cheap    | **15** | 5        | 0       |
| balanced | 5      | **10**   | 5       |
| quality  | 0      | 5        | **15**  |

### Health（`scoreHealth`）

| recentErrorRate | 分  |
| --------------- | --- |
| unknown         | 15  |
| ≤ 0.01          | 20  |
| ≤ 0.1           | 10  |
| ≤ 0.3           | 0   |
| > 0.3           | -20 |

注：`> 0.5` 在 Step 1 已被硬过滤，不会进到打分。

### Tie-break

score 相同时依次比：`priority DESC → isDefault first → modelId 字典序 (稳定性)`。

## 接入改造

### LlmExecutor

```ts
interface LlmExecutorInput<TOutput> {
  // 既有字段保留...
  readonly model?: string; // 新增：election 产出的 modelId
}
```

`chat({ ..., model: input.model })` 原样透给 AiChatService。

### SpecBasedAgent

构造函数新增两个可选依赖：`electionService?` + `envSnapshot?`。`executeSpec` 新签名：

```ts
async executeSpec(
  input: TInput,
  envOverride?: EnvironmentSnapshot,   // pipeline stage 调用时传 identity.capabilities.env
): Promise<SpecAgentResult<TOutput>>
```

内部流程：

1. role = resolveRoleHint(spec.identity.role.id)
2. candidates = buildCandidatesFromSnapshot(env ?? ctor.env)
3. elected = electionService.elect({...})
4. llmExecutor.execute({ model: elected, ...})

无 election / 无 snapshot → `electedModelId = undefined` → 退回旧路径
（AiChatService 自己按 `DEFAULT_AI_MODEL` env + DB default 兜底）。

### Pipeline Stages

所有 stage 的 execute 里：

```ts
runner.executeSpec(input, identity.capabilities?.env);
```

### AgentFactory

新增 `ModelElectionService` 可选注入；`createSpecAgent(spec, envSnapshot?)` 把 env
写进构造函数。

## BYOK 兼容

`KeyResolverService.getAvailableProviders(userId)` 返回用户可用 provider 白名单。
Election 在 Step 2 过滤候选；**过滤后为空**时退回全量池，让下游 AiChatService 抛
`NoAvailableKeyError` 有清晰错误码，比 election 自己抛"无候选"更利排查。

## 向后兼容

- 旧 `AiChatService.chat({ model })` / `{ modelType }` 路径不变
- 没接 Election 的调用方（如 `AiChatLLMAdapter`、admin 自动配置）继续走原链路
- `LlmExecutorInput.model` 可选——Harness 单测可以不传

## 下一阶段

1. **Cost budget 感知**：`identity.budget` 剩余预算 < 30% 时强制 costBias=cheap
2. **Circuit breaker 联动**：从 `CircuitBreakerService` 读最近 5min 失败率覆盖 candidate.recentErrorRate
3. **A/B 评测**：在 ObservabilityService 上记录 election.reason，用于后期数据驱动调参
4. **DB 字段持久化 role hint**：让运维能在管理后台直接配 "这个模型适合 leader"，而不是靠 modelId 正则

## 事故 vs 修复

| 维度                              | 修复前         | 修复后                                    |
| --------------------------------- | -------------- | ----------------------------------------- |
| Caller 不传 model/modelType       | else 分支抛错  | 走 election 选 modelId                    |
| Railway 没配 DEFAULT_AI_MODEL env | 生产直接红     | 走 election 从 DB 选                      |
| 管理后台改默认模型                | 重启才生效     | 下一次请求即时生效                        |
| 用户升级到 reasoning 模型         | 需改代码或 env | Election 自动检测 isReasoning 优选 leader |
| 某模型错误率 > 50%                | 仍可能被命中   | Step 1 硬过滤                             |
