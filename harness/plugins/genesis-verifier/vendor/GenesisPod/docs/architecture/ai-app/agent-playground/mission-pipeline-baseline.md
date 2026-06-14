# Agent Playground — Mission Pipeline 基线

> **文档目的**：把一个 Demo Mission 从用户触发到产物落地的端到端流程梳理成基线，作为后续优化（工具决策机制、循环退出闸、写作输出契约等）的对齐底版。
>
> **范围**：`ai-app/agent-playground` (App 层) ↔ `ai-engine/harness` (Harness 通用 agent 运行时)。不涉及前端渲染细节、不涉及 LLM Provider 选举内部细节。
>
> **维护者**：Claude Code
> **基线日期**：2026-04-26
> **状态**：v0.3（Q1~Q17 全部锁定，含写作契约与三视图）

---

## 0. 关键术语

| 术语                    | 定义                                                                                                      |
| ----------------------- | --------------------------------------------------------------------------------------------------------- |
| **Mission**             | 一次研究任务的业务实体，对应 DB 一行 `agent_playground_missions`。属于 App 层概念，Harness 不知道。       |
| **Stage**               | Mission 内部的串行阶段：Leader / Researchers / Reconciler / Analyst / Writer / Reviewer。属于 App 层。    |
| **Spec**                | App 层用 `@DefineAgent` 装饰的 Agent class（如 `LeaderAgent`），含 inputSchema/outputSchema/loop 等声明。 |
| **AgentRunner**         | Harness 的对外唯一入口（边界 1）：`runner.run(Spec, input, RunOptions) → RunResult`。                     |
| **Loop**                | Harness 内部的执行模式：`react` / `reflexion`。Spec 通过 `loop` 字段选择。                                |
| **IAgentEvent**         | Harness 在 Loop 执行中 emit 的细粒度事件。                                                                |
| **Mission Event**       | App 层 emit 给前端的业务事件。                                                                            |
| **IRuntimeEnvironment** | Harness 定义的环境契约接口（BYOK / 余额 / 模型池查询 / suggestFallback）。App 层实现并注入。              |
| **ToolRegistry**        | Harness 内部的工具中央目录（single source of truth）。CRUD 由系统维护。                                   |
| **ToolCategory**        | 工具的能力分类（'information' / 'generation' / 'processing' / 'execution' / 'integration' / ...）。       |
| **Tool Recall**         | Harness 在起 Loop 前根据 spec 声明的 categories + Leader 提供的 hint 从 Registry **实时拉取**工具子集。   |
| **Exit Reason**         | 迭代出口的标准枚举（10 种），见 §1.4。                                                                    |
| **ReportArtifact**      | Writer 阶段的结构化输出（sections / citations / figures / quickView / factTable / metadata 等），见 §7。  |
| **Reconciler**          | 并行 Researcher 产出后的对账节点（事实表抽取 / 冲突检测 / 重叠检测 / 空白检测），见 §3.5。                |
| **Audit Layer (L0~L4)** | 审核分层（L0 自审 / L1 反思 / L2 同侪 / L3 跨角 / L4 独立复审），见 §6。                                  |

---

## 1. 边界划分（App ↔ Harness）

```
═══════════════════════════════════════════════════════════════════
   ai-app/agent-playground             │      ai-engine/harness
   (业务编排 + 数据模型)                  │      (通用 agent 运行时)
═══════════════════════════════════════════════════════════════════

   - HTTP 路由 / WebSocket             │   - AgentRunner.run()
   - Mission 状态机 / DB 持久化         │   - ReActLoop / ReflexionLoop
   - Stage 串接                         │   - LlmExecutor / 模型选举
   - BillingRuntimeEnvAdapter (实现)   │   - ToolRegistry (单源真理)
   - FailureLearner (跨 mission 记忆)   │   - Tool Recall + Catalog 渲染
   - budgetProfile 翻译                │   - Validator gate (finalize)
   - relayAgentEvents                  │   - 多重出口 + Exit Reason
   - per-dim chapter pipeline          │   - IAgentEvent 流
   - Reconciler / Analyst / Writer     │   - Checkpoint / EventStore
   - User Profile 注入                 │   - Spec version 校验
                                       │
        ─────── 边界 1 ──────────▶
        runner.run(Spec, input, RunOptions)
        ◀──────── RunResult / IAgentEvent
```

### 1.1 边界 1 契约 — 入参 RunOptions

```typescript
interface RunOptions {
  // ─── 用户态 ──────────────────────────────────────
  userId?: string;
  workspaceId?: string;

  // ─── 环境注入 ────────────────────────────────────
  environment?: IRuntimeEnvironment;
  budgetMultiplier?: number; // App 已翻译成数字

  // ─── 工具召回 hint（Q1+Q2）─────────────────────
  toolRecallHint?: {
    categories?: readonly string[];
    excludeIds?: readonly string[];
    preferIds?: readonly string[];
  };

  // ─── 计费 / 事件 ─────────────────────────────────
  billingMeta?: { moduleType; operationType; referenceId };
  onEvent?: (ev: IAgentEvent) => void;

  // ─── 行为开关 ────────────────────────────────────
  exposeCatalog?: boolean;
  onMissingByok?: "fail" | "warn" | "allow";

  // ─── 取消 / 截止时间（Q11）──────────────────────
  signal?: AbortSignal;
  deadline?: number; // epoch ms 截止时间

  // ─── 测试 / 离线（Q17）─────────────────────────
  stubMode?: "off" | "fixture" | "cheap-model";
  fixtureKey?: string; // VCR 录回放 key
}
```

### 1.2 边界 1 契约 — 出参 RunResult（Q4 三段式）

```typescript
interface RunResult<T> {
  // ─── 段 1：业务产物 ─────────────────────────────
  output?: T;                           // 校验全过的产物
  partialOutput?: unknown;              // 失败/降级路径的次优产物

  // ─── 段 2：终态 ──────────────────────────────────
  state: 'completed'|'failed'|'cancelled'|'degraded';
  exitReason: ExitReason;
  failureCode?: HarnessFailureCode;
  diagnostic?: Record<string, unknown>;
  recoveryHint?: { action: 'retry'|'switch_model'|'abort'; reason: string; ... };

  // ─── 段 3：运行元信息 ────────────────────────────
  iterations: number;
  wallTimeMs: number;
  tokensUsed: { prompt: number; completion: number; total: number };
  costCents: number;
  modelTrail: readonly { iter: number; modelId: string; tokens: number }[];
  events: IAgentEvent[];

  // ─── 段 4：工具使用快照 ──────────────────────────
  toolsUsed: readonly { toolId: string; calls: number; totalLatencyMs: number; failures: number }[];
  toolsCatalogSnapshot: readonly string[];
}
```

**关键设计原则**：

- `output` 干净，`partialOutput` 收纳降级产物
- `exitReason` 必填（包括成功路径）
- `tokensUsed / costCents / toolsUsed` 直挂，caller 不需要再 `extractTokenSpend(events)`
- `toolsCatalogSnapshot` 让 trace UI 能展示"这次给了 LLM 哪些工具"

### 1.3 IAgentEvent 类型清单

| type                | payload 关键字段                                     | 时机                      |
| ------------------- | ---------------------------------------------------- | ------------------------- |
| `tools_recalled`    | recalledIds / categories / source ('spec' or 'hint') | Loop 启动前一次           |
| `thinking`          | text / tokenCount / modelId                          | LLM 出 reasoning 时       |
| `action_planned`    | kind / toolId / input / calls                        | LLM 决定 action 后        |
| `action_executed`   | action / output / error / latencyMs / tokensUsed     | Tool 调用完               |
| `validation_failed` | issues / rejectCount / maxRejects                    | finalize 校验闸 reject 时 |
| `reflection`        | revision / score / verdicts                          | Reflexion verifier 评分后 |
| `output`            | output                                               | finalize 校验通过         |
| `error`             | message / failureCode / diagnostic / recoveryHint    | 任何 stage 失败           |
| `terminated`        | exitReason                                           | Loop 终结                 |

### 1.4 ExitReason 标准枚举（Q3 多重出口）

```typescript
type ExitReason =
  | "completed" // finalize + 校验全过
  | "validation_rejected_max" // 校验 reject 达上限，强制接受次优产物
  | "budget_exhausted" // tokensUsed >= maxTokens
  | "max_iterations" // iterations >= maxIterations
  | "wall_time_exceeded" // wallTime >= maxWallTimeMs
  | "failed_parse" // LLM 输出无法 parse 成 action
  | "failed_tool" // 同一 toolId 连续 N 次失败
  | "failed_model" // 模型不可用 + fallback 链耗尽
  | "empty_response" // 连续空输出熔断
  | "cancelled"; // abortSignal triggered
```

**优先级**：`cancelled > failed_* > budget_exhausted > wall_time > max_iterations > validation_rejected_max > completed`

**partialOutput 兜底策略**：

- `completed` / `validation_rejected_max` → output 必填
- `budget_exhausted / max_iterations / wall_time_exceeded` → partialOutput = bestOutput so far
- `failed_*` → partialOutput = 历轮最完整的 finalize 候选
- `cancelled` → partialOutput = 已 finalize 但未通过校验的最后产物

### 1.5 Mission Event 类型清单（App → 前端）

| type                                   | 时机                                   |
| -------------------------------------- | -------------------------------------- |
| `mission:started`                      | [1] 完成                               |
| `stage:started` / `stage:completed`    | 每个 Stage 进出                        |
| `agent:tools-recalled`                 | relay 自 tools_recalled                |
| `agent:thought`                        | relay 自 thinking                      |
| `agent:action`                         | relay 自 action_planned                |
| `agent:observation`                    | relay 自 action_executed               |
| `agent:validation-rejected`            | relay 自 validation_failed             |
| `researcher:completed`                 | 单个 dim 完成                          |
| `dimension:degraded`                   | 单个 dim 失败但 mission 继续           |
| `reconciliation:completed`             | Reconciler 节点结束                    |
| `chapter:rewritten`                    | Writer 局部回写完成                    |
| `failure-pattern:pre-applied`          | 起 researcher 前预先绕开历史失败 model |
| `mission:budget-warning-soft`          | 预算 80% 软告警                        |
| `mission:budget-warning-hard`          | 预算 100% 硬截断                       |
| `mission:cancelled`                    | 用户取消                               |
| `mission:completed` / `mission:failed` | [7] 完成                               |

---

## 2. 主干流程（8 节点）

```
[0] HTTP 触发
[1] Orchestrator 接单 + 准备                          ───── App
[2] Stage A — Leader (规划 + 工具 hint)               ───── App→Harness
[3] Stage B — Researchers ×N (维度研究)               ───── App→Harness ×N
[3.5] Stage B' — Reconciler (对账：事实/冲突/重叠/空白) ───── App→Harness
[4] Stage C — Analyst (跨维度综合)                    ───── App→Harness
[5] Stage D — Writer (W1~W5 内部子流程)                ───── App→Harness ×K
[6] Stage E — Reviewer (评分 + 局部回写触发)           ───── App→Harness
[7] 收尾 (持久化 / 计费 / emit)                        ───── App
```

---

## 3. 节点详细展开

### 3.1 节点 [0] — HTTP 触发

**输入**：

```jsonc
POST /agent-playground/missions
{
  "topic": "AI Agent 框架对比",
  "depth": "deep",                    // ★ 默认 deep（参 §11 用户档位）
  "language": "zh-CN",
  "budgetProfile": "medium",          // ★ 默认 medium
  "styleProfile": "executive",        // ★ 默认 executive
  "audienceProfile": "domain-expert", // ★ 默认 domain-expert
  "withFigures": true,                // ★ 默认 true（图文并茂）
  "auditLayers": "default"            // ★ default = L0+L3 启用，参 §6
}
```

**输出**：HTTP 202 + missionId。

---

### 3.2 节点 [1] — Orchestrator 接单 + 准备（纯 App）

1. **创建 mission 记录**：DB 插入。
2. **构建 BillingRuntimeEnvAdapter**：每 mission 独享。
3. **解析 budgetMultiplier**：`low=0.5 / medium=1.0 / high=2.0 / unlimited=10.0`。
4. **预算预估**（Q10）：根据 depth + budgetProfile + withFigures 估 tokenBudget，记入 mission 行。
5. **解析 UserProfile**：style/length/audience/withFigures/auditLayers，注入 MissionState。
6. **emit `mission:started`**。

---

### 3.3 节点 [2] — Stage A: Leader（规划 + 工具 hint）

**Leader Spec**：

```typescript
@DefineAgent({
  id: 'playground.leader',
  version: '1.2.0',                   // ★ Spec 版本（Q15）
  loop: 'react',
  toolCategories: ['information'],
  inputSchema: { topic, depth, language, audienceProfile },
  outputSchema: {
    themeSummary,
    dimensions: [{
      id, name, rationale,
      toolHint: { categories: string[], preferIds?: string[] },
      dependsOn?: string[],          // ★ 1-2 层依赖支持（Q7-old, 现 §8）
    }]
  }
})
```

**Harness 内部**：

1. precheckByok
2. **Tool Recall**：`Registry.listByCategory(spec.toolCategories)` → emit `tools_recalled`
3. collectAugmentBlocks（runtime 渲染 catalog）
4. materialize → IAgent
5. drainEvents（loop.run）
6. **多重出口闸**

**RunResult**：见 §1.2，output 类型 = LeaderOutput。

---

### 3.4 节点 [3] — Stage B: Researchers ×N（并行）

#### [3.a] 失败模式预查（FailureLearner）

```typescript
const knownFailures = await failureLearner.lookup({
  agentSpecId: "playground.researcher",
  systemPrompt: `${topic}::${dim.name}::${language}`,
});
for (const rec of knownFailures) {
  if (rec.count >= 2 && rec.lastFallbackModel) {
    billing.markModelDisabled(rec.modelId, rec.lastFallbackModel);
  }
}
```

#### [3.b] 跨边界 1：起 Researcher

```typescript
const r = await this.runner.run(ResearcherAgent, {
  topic, dimension: dim.name, language, audienceProfile,
}, {
  ...,
  toolRecallHint: {
    categories: dim.toolHint.categories,
    preferIds: dim.toolHint.preferIds,
  },
  signal, deadline,
});
```

**Researcher Spec**：

```typescript
@DefineAgent({
  id: 'playground.researcher',
  version: '1.2.0',
  loop: 'react',
  toolCategories: ['information'],
  budget: { maxTokens: 30_000, maxIterations: 5, maxWallTimeMs: 180_000 },
  outputSchema: { dimension, findings, summary, factCandidates },
  validateBusinessRules: (output) => { /* findings>=4, source URL, ... */ },
  auditLayers: ['L0'],                // L0 自审；L1 视用户档位
})
```

**Tool Recall 五步**（Q1+Q2）：基础召回 → hint 收窄 → 黑名单减去 → preferIds 标 ★ → 自决空间保留。

**ReActLoop 循环**：典型 3-5 iter；finalize 校验闸 ⟲ 最多 3 次（D2 = 3）。

#### [3.c] 失败处理 / 降级 / FailureLearner 入库

#### [3.d] per-dim chapter pipeline

`outline → writer → reviewer ⟲`，仅在 `auditLayers` 含 'L1'（用户开启反思）或 depth=deep 时启用。

---

### 3.5 节点 [3.5] — Stage B': Reconciler（对账，新增）

**职责**（Q6 锁定 — Reconciliation Pattern）：把 N 个并行 Researcher 的 findings 合并前**强制对账**。

**Reconciler Spec**：

```typescript
@DefineAgent({
  id: 'playground.reconciler',
  version: '1.0.0',
  loop: 'react',
  toolCategories: ['processing', 'information'],  // 用 rag-search 二次确认
  budget: { maxTokens: 20_000, maxIterations: 3 },
  inputSchema: { plan, researcherResults },
  outputSchema: {
    factTable: FactTriple[],
    conflicts: Conflict[],
    overlaps: Overlap[],
    gaps: Gap[],                     // plan.dimensions 未覆盖的洞察空白
    reconciliationReport: string,
  },
  validateBusinessRules: (out) => {
    // 每个 conflict 必须有 resolutionType（不能 'unresolved'）超过阈值
    // overlap 检测必须覆盖所有 dim pair
  },
})
```

**Reconciler 内部步骤**：

1. **抽取事实表**：从所有 dim 的 findings 抽 (entity, attribute, value, sources[])
2. **冲突检测**：同 (entity, attribute) 多个 value → flag conflict
3. **重叠检测**：claim embedding 相似度 > 0.6 → 标记 overlap
4. **空白检测**：plan.dimensions 覆盖 vs 实际产出对比 → flag gap
5. **冲突解决策略**：
   - `kept-both`：保留双方 + 标注分歧（事实级冲突，无法裁决）
   - `preferred-one`：明确裁决一方（有更高 credibilityScore 来源时）
   - `flagged-unresolved`：标记需人工裁决（极少数情况）
6. **输出 reconciliationReport**：可读 markdown，下游 Analyst / Writer 必须显式消费

**emit `reconciliation:completed`**：携带 factTable / conflicts / overlaps / gaps 计数。

---

### 3.6 节点 [4] — Stage C: Analyst（跨维度综合）

**职责**：消费 plan + researcherResults + factTable + reconciliationReport，输出跨维度洞见。

**Analyst Spec**：

```typescript
@DefineAgent({
  id: 'playground.analyst',
  version: '1.2.0',
  loop: 'react',
  inputSchema: { plan, researcherResults, factTable, reconciliationReport, audienceProfile },
  outputSchema: {
    themeSummary,
    keyInsights: Insight[],          // 跨维度洞见
    contradictions: Contradiction[], // 显式处理冲突
    gaps: Gap[],                     // 承接 Reconciler，可能补充
    crossDimAnalysis: string,        // 跨维度分析正文
    riskAssessment: string,
    strategicRecommendations: string,
  },
  validateBusinessRules: (out) => {
    // ★ 强制：reconciliationReport.conflicts 中 kept-both / preferred-one
    // 必须在 contradictions 字段中显式列出（避免假装看不见）
  },
})
```

**关键差异（vs TI）**：

- 强制消费 reconciliationReport（TI optional，是其短板）
- contradictions 字段独立持久化（TI 只放在 markdown 文本里）

---

### 3.7 节点 [5] — Stage D: Writer（W1~W5 内部子流程）

**Writer 是 Stage D 的逻辑名，内部由 5 个 Harness 调用串成**：

```
W1. OutlinePlanner (1 次)
    输入: plan + factTable + lengthProfile + audienceProfile
    输出: chapterOutlines[] / targetWordsPerChapter[] / factAllocation[] / figurePlan[]
    ★ 关键: factTable 提前分配给章节，避免抢/漏
    ★ 关键: figurePlan 决定每章插几张图、什么类型

W2. ChapterWriter ×N (并行, concurrency=3)
    每章独立: runner.run(ChapterWriterAgent, {
      chapterOutline,
      allocatedFacts,
      allocatedRefs,
      allocatedFigures,
      dimensionDraft,
      styleProfile, audienceProfile,
    })
    输出: ChapterDraft { sectionId, markdown, citations[], figureIds[], factsUsed[] }
    ★ 关键: 输入只给该章相关材料 (token 不爆)
    ★ 关键: markdown 中 baked [N] 角标 + ![alt](#fig-id) 图占位

W3. CrossDimSynthesizer (1 次)
    输入: 所有 ChapterDraft + factTable + analystInsights
    输出: executiveSummary / crossDimAnalysis / riskAssessment / recommendations / conclusion
    ★ 关键: 必须显式消费 reconciliationReport
    ★ 关键: noveltyCheck (避免 TI 套话)，不达 0.5 重写

W4. ReportAssembler (1 次)
    输入: 所有片段 + factTable + citationIndex
    输出: ReportArtifact draft (sections / citations / figures / quickView / metadata)
    工作:
      - sections 树构建（type/level/anchor/offsets/wordCount）
      - 引用编号原子分配（与 markdown [N] 1:1）
      - citation.occurrences[] 计算（反向定位）
      - figure 占位符 → figures 表绑定（sectionId/paragraphIndex/referencedBy）
      - quickView 派生（topHighlights / topTrends / keyRisks / keyCitations / keyFigures）
      - 50+ 项格式自动修复（照搬 TI report-assembler.service.ts:679-932）
      - readingTimeMinutes / wordCount 计算

W5. QualityGate + Reviewer ⟲ (1+ 次)
    L0: schema + business rule (硬指标)
    L3: 独立 Reviewer 评分（10 维质量，§7.2.2）
    L1/L4: 视用户 auditLayers 启用
    不达标 → 触发局部回写 (W2 单章 regenerate, max 2 round)
    达标 → emit ReportArtifact
```

**写作输入要求**（Q7）：

- plan.themeSummary / plan.dimensions[]
- dimensionDrafts[]（已加工，非 raw findings）
- factTable + reconciliationReport（强制消费）
- analystInsights
- citationIndex
- styleProfile / lengthProfile / audienceProfile / withFigures（用户档位）

**写作输出要求**（Q7）：见 §7。

---

### 3.8 节点 [6] — Stage E: Reviewer（评分 + 局部回写触发）

**3 路评分**：

- L0 self-review（Writer 自审）— 默认开
- L3 cross-role review（独立 Reviewer Agent）— 默认开
- L1 self-reflect（Reflexion，Writer 自我修正）— 视 auditLayers 用户档位
- L4 critic（独立 Critic Agent，跳出闭环）— 视 auditLayers 用户档位

**输出**：QualityVerdicts（10 维评分 + hardGateViolations + warnings + qualityTrace）

**局部回写循环**（Q5+Q6 关键超越点 — D11=Yes）：

- 发现某 chapter 评分低 → 触发 W2 ChapterWriter 重跑该 chapter（输入加 reviewerCritique reminder）
- 最多 2 round
- 触发后回到 W4 ReportAssembler 重组
- 不重跑整个 mission

---

### 3.9 节点 [7] — 收尾（纯 App）

1. **持久化 result**：更新 `agent_playground_missions`，写入 ReportArtifact JSONB。
2. **计费汇总**。
3. **emit `mission:completed`** 或 `mission:failed`。

---

## 4. 主干循环点

| 循环点                    | 所在节点             | 谁负责               | 退出条件 (ExitReason)                               |
| ------------------------- | -------------------- | -------------------- | --------------------------------------------------- |
| Loop iter (think→act→obs) | 所有 stage           | Harness              | 多重出口（§1.4）                                    |
| Finalize 内容校验闸 ⟲     | 所有 finalize        | Harness              | validate ok / validation_rejected_max（D2=3）       |
| Reflexion verifier ⟲      | auditLayers 含 L1 时 | Harness              | score >= passThreshold / maxRevisions               |
| Writer 局部回写 ⟲         | [5] W2 ↔ [6]         | App                  | reviewerScore >= threshold / max round=2（D11=Yes） |
| Model fallback 链         | 所有 stage           | Harness + RuntimeEnv | suggestFallback='abort' / 链耗尽                    |
| 跨 mission 失败学习       | [3.a] → [3.b]        | FailureLearner       | 持久化（D6 触发阈值=2）                             |
| Tool 连续失败熔断         | 所有 stage           | Harness ReActLoop    | 同 toolId 连续 N=3 次失败（D7=3）                   |
| Stage 重跑（Q9 L2）       | 任何 stage 失败      | App                  | 重跑成功 / 仍失败 → mission resume（Q9 L3）         |

---

## 5. 节点输入/输出契约总览

| Stage           | 主要输入                                                                                                                                   | 主要输出                                                       |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| Leader          | topic / depth / language / audienceProfile                                                                                                 | themeSummary / dimensions[] (含 toolHint)                      |
| Researcher (×N) | topic / dim / language / audienceProfile                                                                                                   | dimension / findings / summary / factCandidates                |
| Reconciler      | plan / researcherResults                                                                                                                   | factTable / conflicts / overlaps / gaps / reconciliationReport |
| Analyst         | plan / researcherResults / factTable / reconciliationReport                                                                                | keyInsights / contradictions / crossDimAnalysis / risk / recs  |
| Writer (W1~W5)  | plan / dimensionDrafts / factTable / reconciliationReport / analystInsights / styleProfile / lengthProfile / audienceProfile / withFigures | **ReportArtifact**（§7）                                       |
| Reviewer        | ReportArtifact                                                                                                                             | QualityVerdicts / 触发局部回写 ChapterIds                      |

---

## 6. 审核分层模型 L0~L4（Q5）

| 层              | 谁负责                              | 范围                   | 默认状态                                                |
| --------------- | ----------------------------------- | ---------------------- | ------------------------------------------------------- |
| **L0 自审**     | Agent 自己（Loop 内 finalize 闸）   | schema + business rule | ★ 总是启用（不可关）                                    |
| **L1 反思**     | Agent 自己（Reflexion verifier）    | 内容质量自评           | ☆ 用户档位控制（默认关）                                |
| **L2 同侪**     | 同角色另一实例                      | 跨实例一致性           | ☆ 用户档位控制（默认关）                                |
| **L3 跨角**     | 下游 Agent（Reviewer 审 Writer 等） | 是否满足下游需要       | ★ 总是启用（不可关）                                    |
| **L4 独立复审** | 独立 Critic Agent（不参与生产）     | 跳出闭环看大方向       | ☆ 用户档位控制（默认 audienceProfile=executive 时启用） |

**默认配置（§11 用户档位）**：`auditLayers='default'` → L0 + L3 启用，L1 + L2 + L4 关闭。

**用户档位 `auditLayers='thorough'`**：L0 + L1 + L3 + L4 全启用（贵 ~2x cost，质量最高）。

**用户档位 `auditLayers='minimal'`**：仅 L0（最快最便宜，仅做 schema 校验，不做内容审核）。

---

## 7. Writer 阶段：ReportArtifact 输出契约（Q7 核心）

### 7.1 ReportArtifact 顶层结构

```typescript
interface ReportArtifact {
  content: {
    fullMarkdown: string;
    fullReportUri?: string;
    fullReportSize: number;
  };
  sections: Section[]; // 章节视图核心
  citations: Citation[]; // 角标溯源核心
  figures: Figure[]; // 图文并茂核心
  quickView: QuickView; // 快速视图核心
  factTable: FactTriple[]; // 超越 TI
  metadata: ReportMetadata;
  quality: QualityVerdicts;
}
```

### 7.2 Section（章节视图核心）

```typescript
interface Section {
  id: string; // 'sec-exec' / 'dim-1' / 'cross-dim' / ...
  type:
    | "executive_summary"
    | "preface"
    | "dimension"
    | "cross_dimension"
    | "risk_assessment"
    | "recommendations"
    | "conclusion"
    | "appendix";
  level: 2 | 3;
  title: string;
  anchor: string; // URL hash
  startOffset: number; // 在 fullMarkdown 中的偏移
  endOffset: number;
  wordCount: number;
  readingTimeMinutes: number;
  parentId?: string;
  children?: Section[];
  citations: number[]; // 该 section 内出现的 [N] 集合
  figureIds: string[];
  factIds: string[];
  noveltyScore?: number; // cross_dim/recommendations 才有
  sourceDimensionId?: string;
}
```

**为什么后端预算 sections**：TI 让前端 `splitFullReportIntoChapters()` 自拆，规则脆弱（`##` 漏一个就乱）。后端预先持久化 sections，三视图共享同一份 fullMarkdown 但都从 sections 取定位。

### 7.3 Citation（角标溯源核心）

```typescript
interface Citation {
  index: number; // 文中 [N]
  uuid: string;
  title: string;
  url: string;
  domain: string;
  snippet?: string;
  snippetUri?: string;
  publishedAt?: string;
  accessedAt: string;
  sourceType: "gov" | "academic" | "industry" | "news" | "blog" | "community";
  credibilityScore: number; // 0-100
  occurrences: CitationOccurrence[]; // ★ 反向定位，超越 TI
}
interface CitationOccurrence {
  sectionId: string;
  paragraphIndex: number;
  characterOffset: number;
}
```

**对齐 TI**：citationIndex 原子分配 / hover 卡 / credibilityScore。
**超越 TI**：`occurrences[]` 让前端实现"点 ReferencePanel 引用条目 → 反向高亮文中所有出现位置"，TI 缺失。

### 7.4 Figure（图文并茂核心）

> ★ **核心合规约束（2026-04-26 锁定）**：
> **图片必须来自参考文献的原始图（reference 类），不自己创造。**
>
> - 不允许 AI 生成图片（image-generation tool）
> - 不允许 LLM 编造数据再用 chart 渲染（generated chart 类**禁用**，下方 type 仅保留 'reference' / 'extracted_chart'）
> - 仅允许从 Researcher / Reconciler 抽到的 **TopicEvidence** 中已有的真实图片 / 表格 / 图表
> - 每张图必须可追溯到一个 `evidenceCitationIndex`（即一个 [N]）
> - 这个约束直接对齐 TI 的"reference 类图过滤"原则，避免 AI 幻觉视觉

```typescript
interface Figure {
  id: string;

  // ★ type 仅这两类，禁止 'generated'（不让 AI 编造图）
  type:
    | "reference" // 原始图片 URL（来自 evidence 截图 / paper / 网页 OG image）
    | "extracted_chart"; // 从 evidence 提取的结构化数据（如 paper 里的表格被 Researcher OCR/parse 出来），
  // 仍然来自参考文献，只是渲染方式可以是 recharts；data 必须有源 URL 可追溯

  // ─── 原图溯源（必填）────────────────────────────────
  evidenceCitationIndex: number; // ★ 必填：图必须挂在某个 [N] 上，不可为空
  sourceUrl: string; // ★ 必填：图的原始 URL（如 paper PDF 内图、网页 figure src）
  sourcePageOrSection?: string; // 在原文献中的位置（"Figure 3" / "Section 4.2"）

  // ─── 原图内容 ─────────────────────────────────────
  imageUrl?: string; // reference 类：原图 URL（可能是 evidence.url + 锚点）
  imageDataUri?: string; // 离线缓存 base64（导出 PDF/DOCX 用）
  data?: ChartData; // extracted_chart 类：结构化数据（必须可追溯到 sourceUrl）
  chartType?: "line" | "bar" | "pie" | "scatter" | "flow" | "table";

  // ─── 描述 ─────────────────────────────────────────
  title: string; // 图标题（来自原文 caption 或 Researcher 提炼）
  caption: string; // 显示给读者的说明（含来源引用 [N]）
  altText: string; // 屏幕阅读器 + PDF 导出，超越 TI
  accessibilityDesc?: string;

  // ─── 定位 ─────────────────────────────────────────
  sectionId: string;
  paragraphIndex: number; // "after_paragraph_2"
  anchorMode: "after_paragraph" | "inline" | "sidebar";
  referencedBy: { sectionId: string; phrase: string }[];

  // ─── 渲染 ─────────────────────────────────────────
  width?: "full" | "half" | "quarter";
  position: "left" | "center" | "right";
}
```

**强校验规则（W4 ReportAssembler 阶段）**：

| 检查                                                                      | 不通过的处理                                 |
| ------------------------------------------------------------------------- | -------------------------------------------- |
| `evidenceCitationIndex` 必须 ∈ citations                                  | 删除该 figure，不放入 ReportArtifact         |
| `sourceUrl` 必须存在且能在 citations[N].url 找到对应                      | 删除该 figure                                |
| `imageUrl` / `imageDataUri` 至少一个非空（reference 类）                  | 删除该 figure                                |
| `data + sourceUrl + sourcePageOrSection` 三字段齐全（extracted_chart 类） | 删除该 figure                                |
| 同一图片 URL 多 figure 重复 → 去重                                        | 保留首次出现，其余 figureIds 指向同一 figure |
| 图片来源 URL 命中 `isGarbageFigureUrl`（QR/favicon/广告等）               | 删除（照搬 TI chart-placeholder.utils.ts）   |

**严禁的实现路径（红线）**：

| 红线                                              | 替代方案                                                          |
| ------------------------------------------------- | ----------------------------------------------------------------- |
| ❌ 调用 `image-generation` tool 让 AI 画图        | 删除该工具的访问权（不在 information category）                   |
| ❌ LLM 编一组数字然后用 recharts 渲染             | extracted_chart 必须 sourceUrl + sourcePageOrSection 双字段才能进 |
| ❌ 用 Vision 模型描述某张图后 LLM "重画"          | 不存在这条路径                                                    |
| ❌ 从 Stock Photo / 通用图库（unsplash 等）找配图 | TI 已有 isGarbageFigureUrl 黑名单，照搬                           |

**图来源链路（端到端）**：

```
Researcher 阶段
  - web-scraper / arxiv-search / pubmed 等返回 evidence
  - evidence 内含原图 URL（HTML <img> / PDF figure / paper supplementary）
  - Researcher 抽取 figureCandidates[] 挂到 finding.figureRefs[]
        ↓
Reconciler 阶段
  - 收集所有 figureCandidates，去重 / 过滤垃圾 URL
  - 用 Embedding 相似度判定与 topic / dim 相关性（照搬 TI figure-relevance.service.ts）
  - 保留通过的 figureCandidates，附带 evidenceCitationIndex 映射
        ↓
W1 OutlinePlanner
  - 从 figureCandidates 池里给每章预分配 figurePlan[]
  - 每章 1-3 张，按相关性分
        ↓
W2 ChapterWriter
  - 在 markdown 中 baked: ![alt](#fig-id "caption")
  - 不允许 LLM 自创 fig-id，只能用 figurePlan 里给定的 id
        ↓
W4 ReportAssembler
  - 强校验（上面表格）
  - 不通过 → 删除 figure + 从 markdown 移除占位
        ↓
前端渲染
  - 标准 markdown <img src="#fig-..."> → 自定义 renderer 查 figures 表
  - reference 类: <FigureCard imageUrl=... caption=... + 来源 [N]>
  - extracted_chart 类: <ChartRenderer data=... + 来源 [N] + sourcePageOrSection 角标>
```

**Markdown 占位符格式（取舍 — 不照搬 TI）**：

```markdown
本年度销售额增长 30% [1]。

![销售趋势](#fig-d0-fig-1 "2026 年季度销售对比")

这一增长主要源自...
```

- **TI** 用 `<!-- chart:dN-id -->`，需要自定义 renderer，导出兼容差。
- **agent-playground** 用标准 markdown image 语法 `![alt](#fig-id "caption")`，前端 renderer 拦截 `src` 以 `#fig-` 开头的图查 figures 表渲染；任何标准 markdown 工具都识别为 image 节点，导出友好。

### 7.5 QuickView（快速视图核心）

```typescript
interface QuickView {
  executiveSummary: { markdown: string; wordCount: number }; // 400-600 字
  topHighlights: Highlight[]; // 5-7 条核心论断
  topTrends: Trend[]; // 跨维度 5 条
  keyRisks: Risk[]; // 3-5 条
  topRecommendations: Recommendation[]; // 3-5 条
  keyCitations: number[]; // 5-8 条最值得读
  keyFigures: string[]; // 3-5 张代表图
  estimatedReadingTime: number; // 3-5 min
  whatYouWillLearn: string[]; // 3-5 条收益
}
```

**对齐 TI**：highlights/topTrends/keyFindings 字段语义一致。
**超越 TI**：派生逻辑搬到后端（TI 在前端 `QuickViewReport.tsx` 做 `slice(0,3)` 不稳定）。

### 7.6 FactTable + ConflictResolution（超越 TI）

```typescript
interface FactTriple {
  id: string;
  entity: string;
  attribute: string;
  value: string;
  sources: number[]; // [N] 编号，可多源印证
  conflict?: ConflictResolution;
}
interface ConflictResolution {
  factIds: string[];
  resolutionType: "kept-both" | "preferred-one" | "flagged-unresolved";
  rationale: string;
}
```

来源：[3.5] Reconciler 节点产物，Writer / Analyst 强制消费。

### 7.7 ReportMetadata + QualityVerdicts

```typescript
interface ReportMetadata {
  topic: string;
  generatedAt: string;
  generationTimeMs: number;
  version: number;
  versionLabel?: string;
  isIncremental: boolean;
  changesFromPrev?: ChangeSummary;
  dimensionCount: number;
  sourceCount: number;
  factCount: number;
  figureCount: number;
  wordCount: number;
  readingTimeMinutes: number;
  styleProfile: "academic" | "executive" | "journalistic" | "technical";
  lengthProfile: "brief" | "standard" | "deep" | "extended";
  audienceProfile: "executive" | "domain-expert" | "general-public";
  language: "zh-CN" | "en-US";
  totalTokens: { prompt: number; completion: number; total: number };
  costCents: number;
  modelTrail: string[];
}

interface QualityVerdicts {
  overall: number; // 0-100
  dimensions: {
    traceability: number;
    factualConsistency: number;
    novelty: number;
    coverage: number;
    redundancy: number;
    formatCorrectness: number;
    citationDensity: number;
    styleConformance: number;
    lengthAccuracy: number;
    chapterBalance: number;
  };
  hardGateViolations: HardGateViolation[];
  warnings: QualityWarning[];
  qualityTrace: QualityTraceEntry[]; // 对齐 TI qualityTrace
}
```

### 7.8 文本质量硬指标（Hard Rules）

| 维度       | 硬指标                                                              | TI 现状        | 我们                               |
| ---------- | ------------------------------------------------------------------- | -------------- | ---------------------------------- |
| 可追溯性   | 每个非常识 claim 必须 ≥1 引用                                       | warning        | **error 级强卡**                   |
| 事实一致性 | factTable 同 (entity, attribute) 多 value → 必须 conflictResolution | optional/log   | **强校验 + 不解决不放行**          |
| 新颖度     | cross-dim/recommendations noveltyScore ≥ 0.5（独立 critic）         | 缺失           | **新增 noveltyMetrics**            |
| 覆盖度     | plan.dimensions 每个都对应一个 chapter                              | 自动跳过空维度 | **不跳过，标 [insufficient-data]** |
| 冗余度     | 章节间 4-gram Jaccard < 0.15                                        | 0.5（宽松）    | **0.15 严格 + 自动改写**           |
| 格式正确性 | LaTeX/Table/List/Heading 错误 = 0                                   | 50+ 项自动修复 | **照搬 TI**                        |
| 引用密度   | 加粗 ≤ 60 / 引用块 ≤ 8 / 单句引用 ≤ 2                               | 已有           | **照搬 TI**                        |
| 风格一致性 | 全文符合 styleProfile（独立 critic）                                | 缺失           | **新增 styleConformance**          |
| 长度准确性 | 实际字数在 lengthProfile 目标的 ±20%                                | 缺失           | **新增 lengthAccuracy**            |
| 章节平衡   | 各 chapter 字数标准差 < 平均 50%                                    | 缺失           | **新增 chapterBalance**            |

### 7.9 多类输出形态（用户可选派生）

| 形态                      | 派生来源                              | 用途                |
| ------------------------- | ------------------------------------- | ------------------- |
| 完整 markdown 报告        | sections + citations + figures        | 默认下载 / 网页阅读 |
| Executive Summary 单页    | quickView.executiveSummary            | 高管简报            |
| 单维度章节                | sections[type=dimension][i]           | 局部分享            |
| Citation-annotated 在线版 | markdown + citations hover 卡         | 网页阅读            |
| Slide 大纲                | sections + factTable 关键事实         | PPT 起稿            |
| 数据集导出（超越 TI）     | factTable + citations CSV             | 给分析师做下游分析  |
| PDF / DOCX / EPUB         | 完整 markdown + 图嵌入 + 角标交叉引用 | 分发                |

---

## 8. 三视图渲染策略（Q7 用户硬要求）

### 8.1 三视图统一数据源

三视图**共用同一份 ReportArtifact**，前端按 URL `?view=` 切换渲染策略，**不发不同 API**。

| 视图     | 渲染来源                                      | 路由                       | UX 重点                                                                  |
| -------- | --------------------------------------------- | -------------------------- | ------------------------------------------------------------------------ |
| **连续** | `content.fullMarkdown` 全文一篇 ReactMarkdown | `?view=continuous`（默认） | 一篇到底滚屏；左侧 mini-TOC 浮动；图随段落出现；阅读进度条               |
| **章节** | 按 `sections[].startOffset~endOffset` 切片    | `?view=chapter[&sec={id}]` | 左侧 TOC 树 + 右侧单章；上下章导航；章节级编辑入口；章节级评论；单章导出 |
| **快速** | `quickView` 派生数据                          | `?view=quick`              | 卡片化布局：摘要 → Highlight 卡 → 关键图 → Top Citations + 阅读全文 CTA  |

### 8.2 三视图共享能力

- 角标 hover 卡（任何视图下点 [N] 都触发）
- 图模态放大
- 引用反向跳回正文（点 ReferencePanel → 用 occurrences[] 高亮）
- 全局搜索（jump-to-anchor）
- 切换视图保留位置（`continuous 滚到 sec-3` ↔ `chapter sec=3`）

### 8.3 角标溯源完整链路

```
[1] 渲染期: fullMarkdown 中 "[1]" → 升级为 <sup data-cite="1">1</sup>
            CitationTooltip 包裹（参考 TI CitationTooltip.tsx）
[2] hover: 查 citations[index===1] → Portal 卡（title/domain/credibility/publishedAt/[打开原文]）
[3] click: scrollToReference(N) → ReferencePanel 高亮该条
[4] 反向溯源（超越 TI）: 点 ReferencePanel 引用条目 → 用 occurrences[] 高亮文中所有位置
[5] 一致性: W4 Assembler 原子写入 markdown [N] + citations + occurrences，不允许后续重排
```

### 8.4 图文并茂完整链路（图在相关段落中出现）

> ★ **核心约束**：所有图必须来自参考文献的原始内容（`type='reference' | 'extracted_chart'`），**禁止 AI 创造图片**。详见 §7.4 红线规则。

```
[A] Researcher 抽图阶段
    1. web-scraper / arxiv-search 等 tool 返回 evidence 时一并抽 figureCandidates
       (evidence 内的 <img> / paper figure / OG image)
    2. 每个 figureCandidate 必须含 sourceUrl + evidenceCitationIndex
    3. 不命中即丢弃，不另起 image-generation

[B] Reconciler 收集与过滤
    1. 全 mission 的 figureCandidates 汇总去重
    2. isGarbageFigureUrl 黑名单（照搬 TI chart-placeholder.utils.ts）
    3. Embedding 相似度过滤（照搬 TI figure-relevance.service.ts）
    4. 输出通过过滤的 figureCandidates 池，附 evidenceCitationIndex

[C] W1 OutlinePlanner 预分配
    1. 从池里按相关性给每章分 1-3 张图
    2. 输出 figurePlan: { chapterId, figureIds[] }

[D] W2 ChapterWriter 落 markdown
    1. 只能使用 figurePlan 给定的 figureIds（不可自创）
    2. 在合适段落后写: ![销售趋势](#fig-d0-1 "标题")
    3. 同时回填 figures 表: { sectionId, paragraphIndex, referencedBy }

[E] W4 ReportAssembler 强校验（§7.4 表格）
    1. evidenceCitationIndex / sourceUrl 必填
    2. 不通过 → 删除 figure + 从 markdown 移除占位
    3. 若 LLM 未指定位置: 用 referencedBy[].phrase 反查
    4. 若仍无线索: 分散注入（避免章末堆图）

[F] 前端渲染期
    1. ReactMarkdown 命中 src="#fig-..." 的 <img>
    2. 自定义 renderer 查 figures[id] 渲染:
       - reference: <FigureCard imageUrl=... caption=... altText=... 来源[N] />
       - extracted_chart: <ChartRenderer data=... type=... 来源[N] page=... />
    3. 卡片右上角: 放大 / 复制源链接 / 跳转原文献

[G] 图与正文段落对应
    - 图永远在它"被引用的句子"所在段落之后
    - 图卡片必显示来源引用 [N] 和 sourcePageOrSection
    - hover 图 → 高亮"被引用的句子"
    - 点正文"如图所示" → 滚到图

[H] 导出保留
    - markdown: 原样保留 ![](#fig-...) + figures 列表附录（含 sourceUrl）
    - PDF: 图 inline + figcaption (含 [N] 引用) + 角标变 footnote
    - DOCX: 图 inline + Word 标准 caption + 角标变交叉引用 + 末尾 References 列表
```

---

## 9. 横切关注点（Q8~Q17 锁定）

### 9.1 Agent 间通信 / 上下文（Q8）

- **MissionState**（App 层维护）：plan / researcherResults / reconciliation / analyst / writer / reviewer，每 stage 只取需要的子集
- **Summarize-on-Handoff**：上下文超 50K tokens 时 App 自动 summarize 后传下游
- **events 留 DB 不进 LLM context**：trace / 失败学习用

### 9.2 失败重试（Q9）

| 级别              | 触发                                         | 动作                                      | 幂等保证           |
| ----------------- | -------------------------------------------- | ----------------------------------------- | ------------------ |
| L1 stage 内       | LLM transient / parse 失败                   | Loop 内 retry（max 2）                    | Loop 自管          |
| L2 stage 重跑     | exitReason ∈ {failed\_\*, budget, wall_time} | 整 stage 重跑，复用上游 stage output      | 上游 output 持久化 |
| L3 mission resume | L2 仍失败 / 用户主动                         | Checkpoint 开始（不丢已 completed stage） | CheckpointService  |

### 9.3 计费 / 预算（Q10）

- 启动时按 depth + budgetProfile + withFigures 估 tokenBudget
- **Soft 80%**：emit `mission:budget-warning-soft`，后续 stage 自动收紧（关 L1/L4、跳 chapter pipeline、Reviewer 简化版）
- **Hard 100%**：当前 stage 完成后立即终止，emit `mission:budget-warning-hard`，partialResult 持久化
- **Stage 预检**：每 stage 进入前 `envAdapter.estimateAffordable(spec.budget)` → 不够走降级

### 9.4 取消（Q11）

- AbortSignal 透传：Orchestrator → AgentRunner → Loop → LLM call → ToolInvoker
- 取消后：当前 stage 立即停，未来 stage 不启，emit `mission:cancelled`，已花照计
- **不做暂停 / 恢复**

### 9.5 可观测性 / Replay（Q12）

| 层        | 内容                                              | 存储                   |
| --------- | ------------------------------------------------- | ---------------------- |
| L1 trace  | OpenTelemetry span（stage / agent / iter / tool） | console / Langfuse     |
| L2 events | RunResult.events 全量                             | `agent_events` 表      |
| L3 replay | envelope snapshot + LLM input/output              | `agent_checkpoints` 表 |

- 失败诊断：`failureCode + diagnostic` 给 90% 信息
- Replay：开发环境（不消费 credits，stub LLM），D12=Yes 暴露给 dev API

### 9.6 多用户隔离（Q13）

- BillingContext (AsyncLocalStorage) ✅
- BillingRuntimeEnvAdapter per-mission 实例 ✅
- BYOK 解析按 userId ✅
- **ToolACL（D13=Yes，p1）**：ToolRegistry 元数据加 `requiredEntitlements: string[]`，ToolInvoker 调用前查 user entitlements

### 9.7 工具副作用 / 幂等（Q14, D14=Yes）

- ToolRegistry 元数据加 `sideEffect: 'none'|'idempotent'|'destructive'`
- L2 stage 重跑时，Harness 检测到 stage 内有 `destructive` 调用历史 → 默认跳过，让 App 决策
- agent-playground 当前用纯 read-only 工具，无影响（但接口先备）

### 9.8 Spec 演进（Q15, D15=强校验）

- `@DefineAgent({ version: '1.2.0' })`
- Checkpoint 存当时的 spec version
- Resume 时不匹配直接拒绝（避免脏数据）
- 灰度暂不做

### 9.9 性能优化杠杆（Q16）

| 杠杆       | 状态                                     |
| ---------- | ---------------------------------------- |
| 减少 iter  | ✅ 内容驱动退出闸                        |
| 减少 token | ⚠️ Tool Recall 待实现 / Summarize 待实现 |
| 并行化     | ✅ Researcher 并行 / W2 章节并行         |
| Streaming  | ✅ IAgentEvent 实时回流                  |

### 9.10 测试 / Stub（Q17, D16）

- **单元测试**：spec.stubFn（按 input hash 返回固定输出）
- **集成测试**：VCR pattern + fixture-store
- **e2e CI**：cheap model（haiku-4.5）走真链路

---

## 10. Q1~Q17 锁定结论

| 锁定点  | 决策                                                                                                                                                                                    |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Q1**  | 工具集合从 ToolRegistry runtime 召回；spec 写 `toolCategories`，不写 id 列表                                                                                                            |
| **Q2**  | Leader 出 `toolHint: {categories, preferIds?}`，Harness 召回，Researcher 在子集内自决                                                                                                   |
| **Q3**  | 多重出口 + 标准 ExitReason 枚举（10 种）+ 优先级排序 + 校验闸独立于 finalize + wall_time / failed_tool 熔断                                                                             |
| **Q4**  | RunResult 三段式（output / partialOutput / 元信息+toolsUsed+toolsCatalogSnapshot）；元信息直挂                                                                                          |
| **Q5**  | 审核 L0~L4 完整实现，**用户档位控制启用**，默认 = L0+L3 启 / L1+L2+L4 关                                                                                                                |
| **Q6**  | Reconciliation Pattern：新增 [3.5] Reconciler 节点 + Analyst 强制消费 reconciliationReport + Final Reviewer + 局部回写                                                                  |
| **Q7**  | Writer 输出 ReportArtifact（结构化非裸 markdown）：sections / citations(occurrences) / figures(标准 ![]) / quickView / factTable / metadata / quality；三视图共享 + 角标溯源 + 图文并茂 |
| **Q8**  | MissionState + Summarize-on-Handoff（>50K 自动）                                                                                                                                        |
| **Q9**  | 三级重试（Loop 内 / stage 重跑 / mission resume），Checkpoint 持久化                                                                                                                    |
| **Q10** | Soft 80% 收紧 / Hard 100% 截断 / Stage 预检 estimateAffordable                                                                                                                          |
| **Q11** | AbortSignal 透传；不做暂停                                                                                                                                                              |
| **Q12** | OTel span + EventStore + Checkpoint replay（dev only，D12=Yes）                                                                                                                         |
| **Q13** | 多用户隔离已基本到位；ToolACL（D13=Yes，p1）                                                                                                                                            |
| **Q14** | ToolRegistry 加 sideEffect 字段；重跑时跳 destructive（D14=Yes）                                                                                                                        |
| **Q15** | Spec version 字段 + checkpoint 强校验（D15）                                                                                                                                            |
| **Q16** | Tool Recall 收窄 catalog + Summarize-on-Handoff + Streaming                                                                                                                             |
| **Q17** | Stub 单测 + VCR fixture-store + cheap model e2e（D16）                                                                                                                                  |

---

## 11. 用户档位（前端配置 + 默认值）

> **用户在 [0] HTTP 触发时可配置以下档位**。**默认值已锁定**。

| 档位              | 选项                                                         | **默认值**         | 说明                                             |
| ----------------- | ------------------------------------------------------------ | ------------------ | ------------------------------------------------ |
| `depth`           | quick / standard / **deep**                                  | **deep**           | 决定维度数（quick=2-3，standard=3-5，deep=5-7）  |
| `budgetProfile`   | low / **medium** / high / unlimited                          | **medium**         | budgetMultiplier=1.0；预算预估基线               |
| `styleProfile`    | academic / **executive** / journalistic / technical          | **executive**      | 文风：执行风格（简洁 / 行动导向 / 数据支撑）     |
| `lengthProfile`   | brief(~3K) / **standard(~8K)** / deep(~15K) / extended(~25K) | **standard(~8K)**  | 报告字数目标，硬指标 ±20% 校验                   |
| `audienceProfile` | executive / **domain-expert** / general-public               | **domain-expert**  | 受众：领域专家（术语放开 / 假设有背景 / 可深入） |
| `withFigures`     | true / false                                                 | **true**           | 图文并茂；false 则跳过 figures pipeline 节省成本 |
| `auditLayers`     | minimal(L0) / **default(L0+L3)** / thorough(L0+L1+L3+L4)     | **default(L0+L3)** | 审核层级，参 §6                                  |
| `language`        | **zh-CN** / en-US                                            | **zh-CN**          | 报告语言                                         |
| `concurrency`     | 1 / 2 / **3** / 5                                            | **3**              | Researcher 并行度                                |
| `viewMode`        | **continuous** / chapter / quick                             | **continuous**     | 默认进入哪个视图（前端可切换）                   |

**用户视角的"默认 = 深度 + 图文 + 中等其他"**：

- 深度：`depth=deep`（5-7 维度）+ `lengthProfile=standard(~8K)`（适中字数）+ `auditLayers=default(L0+L3)`（基础审核）
- 图文：`withFigures=true`
- 中等其他：`budgetProfile=medium` / `styleProfile=executive` / `audienceProfile=domain-expert` / `concurrency=3`

**预算估算示例**（deep + medium + with figures + L0+L3）：

- Leader: ~16K tokens
- Researcher×6: 6 × ~30K = ~180K tokens
- Reconciler: ~20K
- Analyst: ~25K
- Writer (W1+W2×6+W3+W4+W5): ~120K
- Reviewer (L3): ~30K
- **合计 ≈ 390K tokens / mission**

---

## 12. 决策点完整清单

| ID  | 节点      | 决策                                        | 状态 / 取值                                                                                                                         |
| --- | --------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| D1  | [2]/[3.b] | Researcher 工具决策权                       | ✅ Q1+Q2: Leader hint + Harness 召回 + Agent 自决                                                                                   |
| D2  | [3.b]     | finalize 校验闸 reject 上限                 | **3**                                                                                                                               |
| D3  | [3.d]     | per-dim chapter pipeline 触发条件           | **auditLayers 含 L1 或 depth=deep**                                                                                                 |
| D4  | [6]       | Reviewer 是否触发 Writer 局部回写           | ✅ **Yes，max 2 round**                                                                                                             |
| D5  | 边界 1    | toolsOverride 字段（演化为 toolRecallHint） | ✅ 已加                                                                                                                             |
| D6  | [3.a]     | FailureLearner 触发阈值                     | **count >= 2**                                                                                                                      |
| D7  | [3.b]     | Tool 连续失败熔断阈值 N                     | **3**                                                                                                                               |
| D8  | [3.b]     | 校验闸 reminder 注入策略                    | **累积式**（每次 reject 追加）                                                                                                      |
| D9  | 全局      | wall_time 默认值                            | per-stage **180s**, mission **1800s**                                                                                               |
| D10 | §6        | 审核层默认开启策略                          | ✅ default = L0 + L3                                                                                                                |
| D11 | [6]       | Reviewer → Writer 局部回写                  | ✅ Yes                                                                                                                              |
| D12 | 9.5       | Replay API 暴露给 dev                       | ✅ Yes（仅 dev 环境）                                                                                                               |
| D13 | 9.6       | ToolACL（per-user 工具权限）                | ✅ Yes，p1                                                                                                                          |
| D14 | 9.7       | 工具 sideEffect 元数据                      | ✅ Yes                                                                                                                              |
| D15 | 9.8       | Spec version checkpoint 校验                | ✅ 强校验                                                                                                                           |
| D16 | 9.10      | CI 测试策略                                 | Stub 单测 + cheap model e2e + VCR                                                                                                   |
| D17 | §11       | dim.dependsOn DAG                           | p1（默认全并行；DAG 是进阶）                                                                                                        |
| D18 | §7        | markdown 占位符格式                         | ✅ 标准 image 语法 `![alt](#fig-id)`                                                                                                |
| D19 | §7        | citation.occurrences[] 反向定位             | ✅ Yes，p0                                                                                                                          |
| D20 | §11       | 默认用户档位                                | ✅ 深度 + 图文 + 其他中等                                                                                                           |
| D21 | §7.4      | 图片来源约束                                | ✅ **仅 reference / extracted_chart 两类，必须挂 evidenceCitationIndex + sourceUrl；禁止 AI 生成图，禁止编数据画图，禁止 stock 图** |

---

## 13. 实现优先级路线图

### P0（必须随基线实现）

- ToolRegistry.listByCategory() + sideEffect / requiredEntitlements 元数据
- AgentRunner toolRecallHint 入参 + Tool Recall 五步流程
- ExitReason 标准枚举 + RunResult 三段式
- LeaderAgent.toolHint 输出 + 默认值
- ResearcherAgent spec 改 toolCategories（不写 id 列表）
- [3.5] Reconciler 节点完整实现
- Writer W1~W5 子流程 + ReportArtifact 输出契约
- 三视图前端组件（ContinuousReader / ChapterReader / QuickReader）
- Citation occurrences 反向定位
- 标准 markdown image 占位符 + figure renderer
- **图来源强校验**（§7.4 红线 + 全链路 [A]~[E]，禁止 AI 生成图，仅 reference / extracted_chart 两类，必须挂 evidenceCitationIndex + sourceUrl）
- 用户档位前端配置 + 默认值
- 10 维质量硬指标 + 局部回写

### P1（基线后第一波迭代）

- L1 self-reflect / L4 critic 接通
- altText / accessibilityDesc
- referencedBy 反向定位
- Replay API（dev only）
- ToolACL
- dim.dependsOn 1-2 层 DAG
- styleProfile / lengthProfile / audienceProfile 完整 prompt 工程

### P2（差异化能力）

- 数据集 CSV 导出
- 章节级评论 / 批注
- 局部 LLM 改稿（用户高亮一段说"改这段"）

### P3（长尾）

- EPUB 导出
- 加密分享 / 过期时间 / 密码保护
- 灰度 spec 升级

---

## 14. 后续文档

每个决策点单独出实现文档：

- `mission-pipeline-tool-recall.md`（D1, D5, P0）
- `mission-pipeline-exit-policy.md`（Q3, P0）
- `mission-pipeline-runresult-schema.md`（Q4, P0）
- `mission-pipeline-reconciler.md`（[3.5], P0）
- `mission-pipeline-writer-artifact.md`（Q7 + 三视图 + 角标 + 图文，P0）
- `mission-pipeline-audit-layers.md`（Q5, §6, P0/P1）
- `mission-pipeline-finalize-gate.md`（D2, D8）
- `mission-pipeline-failure-learning.md`（D6）
- `mission-pipeline-tool-failure-circuit.md`（D7）
- `mission-pipeline-user-profiles.md`（§11, P0）
- `mission-pipeline-replay-api.md`（D12, P1）
- `mission-pipeline-tool-acl.md`（D13, P1）

---

## 15. 修订历史

| 日期       | 版本 | 修订内容                                                                                                                                                                                                                                                                                                                                                                                                      | 作者        |
| ---------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 2026-04-26 | v0.1 | 初版基线，主干 7 节点 + 6 个待定决策点                                                                                                                                                                                                                                                                                                                                                                        | Claude Code |
| 2026-04-26 | v0.2 | Q1~Q4 锁定：工具召回 from Registry / Leader 出 hint Researcher 自决 / 多重出口 + ExitReason / RunResult 三段式                                                                                                                                                                                                                                                                                                | Claude Code |
| 2026-04-26 | v0.3 | Q5~Q17 全部锁定 + Writer ReportArtifact 契约（三视图 + 角标 occurrences[] + 图文并茂标准 markdown image 占位符）+ 新增 [3.5] Reconciler 节点 + 审核 L0~L4 + 用户档位（默认深度+图文+中等其他）                                                                                                                                                                                                                | Claude Code |
| 2026-04-26 | v0.4 | 图片来源红线锁定（D21）：图必须来自参考文献原始内容，仅 'reference' / 'extracted_chart' 两类，必须挂 evidenceCitationIndex + sourceUrl；禁止 AI 生成图、禁止编数据画图、禁止 stock 图。Figure schema 重构 + W4 强校验表 + 端到端 [A]~[H] 链路                                                                                                                                                                 | Claude Code |
| 2026-04-26 | v0.5 | P0~P7 实施完成（~67 phase）：边界契约 / Tool Recall / RunResult 三段式 / [3.5] Reconciler / W1 OutlinePlanner / W4 Assembler / Critic L4 / 三视图 / 角标 occurrences[] 反向溯源 / 图来源管线 / 10 维 quality 真实评分 / DAG 调度 / Summarize-on-Handoff / Tool ACL entitlements / FailureLearner 接 Reconciler+Analyst+Writer / CSV+JSON+Markdown 三格式导出 / DemoLauncher 预算估算。所有改动 TS strict 通过 | Claude Code |
