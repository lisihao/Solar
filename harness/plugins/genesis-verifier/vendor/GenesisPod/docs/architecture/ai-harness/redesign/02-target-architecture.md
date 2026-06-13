# Topic Insights · 目标架构 v2

> 版本：v2（应用 10-review-and-gaps.md 的设计修正）
>
> 关键修正：
>
> - PipelineContext 分段式（不是 god object）
> - Stage checkpoint 与持久化契约绑定
> - AbortSignal 传播链显式
> - Agent/Tool 访问矩阵定义
> - Iron-wall 拆成 6 条独立 utility
> - 成本预算（PipelineBudget）
> - 目录结构 + PR checklist（代替 custom ESLint）

---

## 一、五层架构总览

（与 v1 相同，但层级内的元素重分类；图略，见 v1 同节）

**新强调**：

- Layer 0（Infra）新增 `PipelineBudget`、`AbortController`、`CheckpointStore`
- Layer 1（Utility）新增 Iron-wall 6 条独立 utility
- Layer 4（Agent）每个 agent 明确 `tools: [...]` 白名单（access matrix）
- Layer 5（Pipeline）stages 从"线性数组"改为"DAG"

---

## 二、分段式 Context 设计（修正 v1 god object）

### 2.1 顶层 Identity Context（所有 stage 可读）

```typescript
// pipeline/types/identity-context.ts

export interface PipelineIdentityContext {
  readonly missionId: string;
  readonly topicId: string;
  readonly reportId: string; // draft report id, created in ST-00
  readonly userId: string;
  readonly cachePrefix: string; // per-mission prompt cache prefix
  readonly abortController: AbortController;
  readonly budget: PipelineBudget;
  readonly depthConfig: ResearchDepthConfig; // non-optional
  readonly mode: "fresh" | "incremental";
  /**
   * ★ v2.1（2026-04-23）：运行时能力快照。
   * 由 CapabilityDiscoveryService.snapshot() 在 runWithHarness 入口生成，
   * 所有 stage / agent 通过 identity.capabilities 读可用模型 / 工具 / agent，
   * 禁止再直接访问 process.env 或 registry（运行时漂移由 ModelFallback 层处理）。
   * 详见 11-capability-discovery.md。
   */
  readonly capabilities: CapabilitySnapshot;
}
```

### 2.1.1 Capability Discovery（Pipeline 启动前置环节）

**v2.1 架构补丁（2026-04-23）**：`runWithHarness` 进入 `ST-00-INIT` 之前必须先调用 `CapabilityDiscoveryService.snapshot(userId, requestedDepth)`，生成 `CapabilitySnapshot` 注入 `PipelineIdentityContext`。

- `CapabilitySnapshot` 字段、降级规则、失败模式：见 **[11-capability-discovery.md](./11-capability-discovery.md)**
- Leader（AG-01-LD）规划时，system prompt 必须列出 snapshot 中的可用模型 / agent / tool，Leader 输出受 Zod + business-rule 双重校验（unknown modelId → retry）
- 致命 degradation（CHAT 模型全挂 / BYOK 缺失且无共享 key / 关键表缺失）→ mission 在 runWithHarness 入口即 fail，不进入 pipeline

### 2.2 Stage 输入输出显式类型

每个 Stage 定义明确的 `Input` 和 `Output`：

```typescript
// pipeline/types/stage.ts

export interface Stage<TInput, TOutput> {
  readonly id: StageId; // e.g. 'ST-01-PLAN'
  readonly name: string;
  readonly dependsOn: StageId[]; // DAG 依赖
  readonly runsWhen: StageCondition; // 条件执行
  readonly slo: StageSLO; // P95 / P99 / maxTokens / successRate
  readonly emitsEvents: StageEvent[]; // 声明式事件契约

  prepare(
    identity: PipelineIdentityContext,
    upstreamResults: StageResults,
  ): Promise<TInput>;

  execute(
    identity: PipelineIdentityContext,
    input: TInput,
    signal: AbortSignal,
  ): Promise<TOutput>;

  persist(identity: PipelineIdentityContext, output: TOutput): Promise<void>; // 持久化到 DB，resume 依据

  cleanup?(identity: PipelineIdentityContext): Promise<void>;
}
```

### 2.3 StageResults 访问模式

```typescript
// pipeline/types/stage-results.ts

export class StageResults {
  private results = new Map<StageId, unknown>();

  set<T>(stageId: StageId, output: T): void;
  get<T>(stageId: StageId): T; // 抛错如果未完成
  has(stageId: StageId): boolean;
  rebuild(missionId: string): Promise<void>; // 从 DB 读回，resume 用
}
```

**Stage 间数据流通**：

- `ST-02` 的 prepare 从 `upstreamResults.get<LeaderPlan>('ST-01-PLAN')` 拿 Stage 1 输出
- 类型安全（`<LeaderPlan>` 强制类型）
- Resume 时 Pipeline 先调 `rebuild` 从 DB 重建所有上游 results

---

## 三、Stage DAG 定义（不是线性数组）

### 3.1 14 个 Stage + 依赖图

```
            ST-00-INIT
                │
                ▼
            ST-01-PLAN ──────────────┐
                │                    │
                ▼                    │
          ST-02-RESEARCH             │
          (per-dimension parallel)   │
                │                    │
                ▼                    │
          ST-03-WRITE                │
          (per-section parallel)     │
                │                    │
                ▼                    │
          ST-04-REVIEW               │
          (while loop)               │
                │                    │
                ▼                    │
          ST-05-INTEGRATE            │
                │                    │
                ▼                    │
          ST-06-COGLOOP              │
          (thorough+ only)           │
                │                    │
                ▼                    │
          ST-07-SYNTH ◄───────────┐  │
                │                  │ │
                ├──►  ST-10-FACT ──┤ │
                │    (thorough+)   │ │
                │                  │ │
                ▼                  │ │
          ST-08-QGATE ──┐          │ │
                │       │          │ │
                │       ▼          │ │
                │   (fail) AG-12 remediate
                │       │          │ │
                │       └──► re-enter ST-07 (max 2 rounds)
                ▼                  │
          ST-09-EVAL (thorough+)   │
                │                  │
                ▼                  │
          ST-11-ASM ◄──────────────┘
                │
                ▼
          ST-12-LATEX
          (if validateLatex.issues.length > 0)
                │
                ▼
          ST-13-PERSIST
                │
                ▼
          ST-14-CLEANUP
```

**关键改进 vs v1**：

- Stage 07 ↔ Stage 08 有**循环**（quality gate 不过 → remediate → 回 07 重合成），但有 `maxRounds=2` 硬限
- Stage 10 Fact-check **并行** 于 Stage 08（都依赖 Stage 07 的 synthesis）
- Stage 12 Latex 条件执行（`UT-LTX-VALIDATE` 有 issues 才跑）

### 3.2 Stage 清单（含 SLO）

| Stage ID        | 名称                                                   | depends_on     | runsWhen       | P95          | maxTokens   | Tier        |
| --------------- | ------------------------------------------------------ | -------------- | -------------- | ------------ | ----------- | ----------- |
| ST-00-INIT      | 初始化（cache prefix / budget / abort / lookup）       | —              | always         | 500ms        | 0           | Core        |
| ST-01-PLAN      | Leader 全局规划                                        | ST-00          | always         | 60s          | 30k         | Core        |
| ST-02-RESEARCH  | 维度研究（含 2a 文献 / 2b 搜索 / 2c 图 / 2d evidence） | ST-01          | always         | 300s/dim     | 50k/dim     | Core        |
| ST-03-WRITE     | Outline + 分章节写作                                   | ST-02          | always         | 180s/section | 20k/section | Core        |
| ST-04-REVIEW    | Section 级审核 + 修订                                  | ST-03          | always         | 120s/section | 15k/section | Core        |
| ST-05-INTEGRATE | Dimension 合并 + meta                                  | ST-04          | always         | 60s/dim      | 10k/dim     | Core        |
| ST-06-COGLOOP   | V5 认知循环（claim/gap/re-verify）                     | ST-05          | thoroughOrDeep | 300s         | 60k         | Enhancement |
| ST-07-SYNTH     | 报告合成                                               | ST-05          | always         | 180s         | 40k         | Core        |
| ST-08-QGATE     | 质量硬门 + remediate loop                              | ST-07          | always         | 120s         | 20k         | Enhancement |
| ST-09-EVAL      | 10 维评审                                              | ST-07          | thoroughOrDeep | 90s          | 15k         | Enhancement |
| ST-10-FACT      | Fact-check 整报告                                      | ST-07          | thoroughOrDeep | 180s         | 30k         | Enhancement |
| ST-11-ASM       | 报告组装（TOC / figure / citation）                    | ST-07+08+09+10 | always         | 10s          | 0           | Core        |
| ST-12-LATEX     | LaTeX 修复                                             | ST-11          | hasLatex       | 60s          | 10k         | Advanced    |
| ST-13-PERSIST   | 持久化 + emit COMPLETED                                | ST-11(+12)     | always         | 5s           | 0           | Core        |
| ST-14-CLEANUP   | AutoDream + cache release + 审计                       | ST-13          | always         | 2s           | 0           | Core        |

---

## 四、Agent 访问矩阵（access control）

### 4.1 17 个 Agent × Tool 白名单

| Agent                          | Read-only tools                                                  | Write tools                         | Why                                  |
| ------------------------------ | ---------------------------------------------------------------- | ----------------------------------- | ------------------------------------ |
| AG-01-LD (Leader)              | short/long-term-memory, rag-search, knowledge-graph, TL-07-MODEL | —                                   | 规划不写入                           |
| AG-02-DP (DimensionPlanner)    | TL-04-DIMMEM, rag-search                                         | —                                   | outline 只读                         |
| AG-03-SW (SectionWriter)       | TL-06-SEARCHMULTI (实际调 9 路), rag-search, TL-03-FIGEXT        | **TL-02-EVSAVE**, short-term-memory | 写 evidence 必须明示                 |
| AG-04-SR (SectionReviewer)     | rag-search, knowledge-graph, TL-04-DIMMEM                        | —                                   | **禁止** evidence-save               |
| AG-05-ME (MetaExtractor)       | —                                                                | —                                   | 纯 LLM transformation                |
| AG-06-QR (QualityReviewer)     | rag-search (read-only), TL-04-DIMMEM                             | —                                   | **禁止** evidence-save               |
| AG-07-FC (FactChecker)         | rag-search, knowledge-graph                                      | —                                   | **禁止** evidence-save               |
| AG-08-GS (GapSearcher)         | —                                                                | —                                   | 只出 queries，不执行                 |
| AG-09-HV (HypothesisVerifier)  | rag-search                                                       | —                                   | 只读                                 |
| AG-10-FX (FactExtractor)       | TL-04-DIMMEM                                                     | —                                   | 跨维度，只读                         |
| AG-11-SY (Synthesizer)         | rag-search (read-only), TL-04-DIMMEM                             | —                                   | **严禁** evidence-save（防止假证据） |
| AG-12-SREM (SectionRemediator) | rag-search                                                       | —                                   | 只修改 section 文本，不写 evidence   |
| AG-13-RE (ReportEvaluator)     | —                                                                | —                                   | 纯评分                               |
| AG-14-LX (LatexRepair)         | —                                                                | —                                   | 纯文本修复                           |
| AG-15-RED (ReportEditor)       | —                                                                | —                                   | 纯文本编辑                           |
| AG-16-MA (MissionAdjuster)     | —                                                                | —                                   | 纯 LLM decision                      |
| AG-17-LDP (LeaderDispatcher)   | —                                                                | —                                   | 意图识别                             |

### 4.2 Harness 内核强制校验

Agent runner 构建 `IAgentSpec` 时，`spec.identity.tools[]` 从 access matrix 读取。HarnessFacade.execute 在 tool 调用前检查 `spec.tools.includes(toolName)`，不在白名单拒绝。

---

## 五、PipelineBudget 设计（CP-M.3 / 原则 7）

```typescript
// pipeline/types/budget.ts

export interface PipelineBudget {
  readonly maxTotalTokens: number; // per-mission hard limit
  readonly maxTotalCostUsd: number;
  readonly maxToolCalls: number;
  readonly maxWallTimeMs: number;
  readonly degradationThresholdPct: number; // e.g. 80% → skip optional stages

  // Mutable counters (updated after each agent run)
  tokensUsed: number;
  costUsd: number;
  toolCallsCount: number;
  wallTimeMs: number;

  // Query methods
  canAfford(estimatedTokens: number): boolean;
  shouldDegrade(): boolean; // true if usage >= degradationThresholdPct
  isExhausted(): boolean; // true if usage >= 100%
}
```

Depth-based defaults：

| Depth    | maxTotalTokens | maxTotalCostUsd | maxToolCalls | maxWallTimeMs |
| -------- | -------------- | --------------- | ------------ | ------------- |
| quick    | 100k           | $1              | 30           | 5 min         |
| standard | 200k           | $2              | 80           | 10 min        |
| thorough | 500k           | $5              | 200          | 30 min        |
| deep     | 1M             | $10             | 400          | 60 min        |

ST-00 初始化 budget。Pipeline 每个 agent run 后：

```typescript
await runner.run(ctx, signal);
budget.tokensUsed += result.tokensUsed;
budget.costUsd += result.cost;
budget.toolCallsCount += result.toolCallsCount;
if (budget.isExhausted()) {
  throw new BudgetExhaustedError(stageId);
}
if (budget.shouldDegrade()) {
  ctx.degradationMode = true; // 后续 stage 跳过 optional
}
```

---

## 六、AbortSignal 传播契约（CP-M.7 / E.3 修正）

### 6.1 传播链

```
User cancelMission()
  → MissionLifecycleService.cancelMission()
  → abortController.abort()
  → Pipeline.execute() 的 outer signal
  → Stage.execute(identity, input, signal)
  → AgentRunner.run(ctx, signal)
  → HarnessFacade.execute(spec, task, { signal })  ← 需要内核改动
  → AiChatService.chat({ ..., signal })              ← 需要内核改动
  → LLM SDK fetch({ signal })
```

### 6.2 Harness 内核需要的改动（跨 scope）

**若 Gate 1 通过**：

- `HarnessFacade.execute` 签名加第三参数 `options?: { signal?: AbortSignal }`
- ReActLoop 在每次 tool 调用 / LLM 调用前 check `signal.aborted`，为 true 抛 `AbortError`
- `AiChatService.chat` 参数加 `signal`，内部传给 LLM SDK

**若 Gate 1 拒绝**（降级方案）：

- Pipeline 层面 signal：Stage 边界检查，当前 stage 跑完才 abort
- 正在运行的 agent 不能中断
- cancelMission 对前端的承诺降级为 "取消已提交，当前步骤跑完后停止"

### 6.3 Pipeline 层 signal 使用

```typescript
async execute(input: PipelineInput): Promise<PipelineOutput> {
  const identity = await this.buildIdentity(input);
  const signal = identity.abortController.signal;

  for (const stage of this.orderedStages) {
    if (signal.aborted) throw new AbortError();
    if (!stage.runsWhen(identity, results)) continue;

    const upstreamInput = await stage.prepare(identity, results);
    const output = await stage.execute(identity, upstreamInput, signal);
    await stage.persist(identity, output);
    results.set(stage.id, output);

    await checkpointStore.mark(identity.missionId, stage.id);
  }

  return finalizeOutput(results);
}
```

---

## 七、持久化与 Resume 契约（修正 E.2）

### 7.1 每个 Stage 的 persist 写入位置

| Stage           | Persist 目标                                                      | 字段                           |
| --------------- | ----------------------------------------------------------------- | ------------------------------ |
| ST-01-PLAN      | `ResearchMission.leaderPlan`                                      | JSON field（已存在）           |
| ST-02-RESEARCH  | `DimensionAnalysis.dataPoints.searchResults` + `TopicEvidence` 表 | 新 JSON path（无 schema 变更） |
| ST-03-WRITE     | `DimensionAnalysis.dataPoints.sections`                           | 新 JSON path                   |
| ST-04-REVIEW    | `DimensionAnalysis.dataPoints.sectionReviews`                     | 新 JSON path                   |
| ST-05-INTEGRATE | `DimensionAnalysis.summary` + `keyFindings`                       | 现有字段                       |
| ST-06-COGLOOP   | `DimensionAnalysis.dataPoints.cognitiveLoopResults`               | 新 JSON path                   |
| ST-07-SYNTH     | `TopicReport.executiveSummary` + `fullReport` + `highlights`      | 现有字段                       |
| ST-08-QGATE     | `TopicReport.qualityTrace.gateReport`                             | 现有 qualityTrace JSON         |
| ST-09-EVAL      | `TopicReport.qualityTrace.evaluation`                             | 现有 qualityTrace JSON         |
| ST-10-FACT      | `TopicReport.qualityTrace.factCheck`                              | 现有 qualityTrace JSON         |
| ST-11-ASM       | `TopicReport.fullReport`（覆盖 ST-07）+ `fullReportUri`           | 现有                           |
| ST-12-LATEX     | `TopicReport.fullReport`（可能覆盖）                              | 现有                           |
| ST-13-PERSIST   | `TopicReport.totalSources` + `generationTimeMs`                   | 现有                           |

**关键约束**：

- 所有 Stage 输出**必须持久化**才 markCompleted
- Resume 时 StageResults.rebuild 从这些位置读回

### 7.2 Checkpoint 表

```prisma
model ResearchPipelineCheckpoint {
  missionId    String
  stageId      String
  completedAt  DateTime @default(now())
  outputJson   Json?    // stage output (redundant with above fields, for resume)

  @@id([missionId, stageId])
}
```

**评估**：是否加这表？还是用现有字段？

- 加表优点：resume 简单（一条查询出所有已完成 stage）
- 不加表：每个 stage 重 build 时查各自字段，代码繁琐但不动 schema
- **决策**：本次不加表（遵循"Phase 6 前不改 schema"）；resume 通过多字段查询实现

---

## 八、目录结构（保持，增补）

（同 v1 第四节目录结构，增补）：

新增：

```
backend/src/modules/ai-app/topic-insights/
├── pipeline/
│   ├── types/
│   │   ├── identity-context.ts
│   │   ├── stage.ts
│   │   ├── stage-results.ts
│   │   └── budget.ts         (NEW)
│   ├── budget/
│   │   └── pipeline-budget.ts (NEW class)
│   └── checkpoint/
│       └── checkpoint-store.ts (NEW, backed by existing ResearchCheckpointService)
│
├── utils/
│   ├── iron-wall/             (NEW directory)
│   │   ├── detect-emoji.ts
│   │   ├── detect-placeholder.ts
│   │   ├── detect-template-opening.ts
│   │   ├── detect-fuzzy-quantifier.ts
│   │   ├── detect-internal-role.ts
│   │   └── detect-html-tags.ts
```

---

## 九、PR Checklist（代替 ESLint plugin）

放 `.github/pull_request_template.md` 或 GitHub Actions 检查：

```markdown
## Topic Insights Pipeline Architecture Compliance

- [ ] Pipeline 层文件（`pipeline/**`）未出现 `import.*AiChatService|HarnessFacade`
- [ ] Agent runner 文件（`harness-agents/**/runner.ts`）未出现 `import.*PrismaService`
- [ ] Utility 文件（`utils/**`）未出现 `import.*(Service|Controller|Module)`
- [ ] Tool 文件（`harness-tools/**`）未出现 `AiChatService` 调用
- [ ] 新增能力对应 CP-ID 已在 `01-capability-matrix.md` 登记
- [ ] Zod schema 与 `09-data-contracts.md` 对应
- [ ] SLO 已定义（见本文档 Stage 表）
- [ ] 若 agent 写入 evidence，access matrix（第四节）允许此 agent 使用 TL-02
```

CI 简单 bash 检查（2 小时实现）：

```bash
#!/bin/bash
# ci/check-layering.sh
set -e

check_layer() {
  local path=$1
  local forbidden=$2
  if grep -rn "$forbidden" "$path" --include="*.ts" --exclude-dir=__tests__; then
    echo "❌ Forbidden import in $path: $forbidden"
    exit 1
  fi
}

check_layer 'src/modules/ai-app/topic-insights/pipeline' 'AiChatService\|HarnessFacade'
check_layer 'src/modules/ai-app/topic-insights/harness-agents' 'PrismaService'
check_layer 'src/modules/ai-app/topic-insights/utils' 'import.*Service'
check_layer 'src/modules/ai-app/topic-insights/harness-tools' 'AiChatService'

echo "✅ Layering compliance check passed"
```

---

## 十、v2 相对 v1 的改动总结

| 项              | v1                    | v2                                        |
| --------------- | --------------------- | ----------------------------------------- |
| Context         | 单一 god object       | 分段（IdentityContext + StageResults）    |
| Stage 组织      | 线性数组              | DAG，明确 dependsOn                       |
| Stage 输入输出  | 通过 ctx 共享         | 显式 `Stage<Input, Output>` 类型          |
| Agent-Tool 访问 | 未定义                | 17 agent × tool 白名单矩阵                |
| Iron wall       | 1 个 utility          | 拆为 6 个独立 utility（UT-IW-\*）         |
| 预算            | 无                    | PipelineBudget 显式类                     |
| AbortSignal     | 暗示                  | 显式契约（带 Gate 1 决策分支）            |
| Resume          | 模糊                  | 每 Stage 持久化字段明确（无 schema 改动） |
| 分层强制        | custom ESLint（空头） | 目录结构 + PR checklist + CI bash         |
| SLO             | 无                    | 每 Stage 定义                             |
| Tier 划分       | 未分                  | Core/Enhancement/Advanced                 |
| 文档 Gate       | 隐式                  | 3-Gate 显式流程                           |
