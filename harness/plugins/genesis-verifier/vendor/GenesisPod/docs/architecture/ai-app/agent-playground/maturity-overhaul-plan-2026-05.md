# 三层架构成熟度彻底整改作战图（2026-05-15）

> **依据**：2026-05-15 四路并行审计（arch-auditor / 标杆评估 / 业界对标 / SOTA 复核 + 3 路侦察 agent）
> **目标**：在 4-6 周内把 GenesisPod Playground 从 95/120（二线前 3，距 Anthropic Managed Agent 15 分）推到 110+/120（一线对齐 95%）
> **当前**：架构成熟度 7.2/10，playground 标杆资格 82/100 有条件
> **整改后**：架构成熟度 9.0+/10，playground 标杆资格 95+/100 无条件

---

## 一、整改 PR 一览（10 个 PR）

| #   | PR                                             | 类型     | 优先级 | 工作量 | 状态         | 依赖 |
| --- | ---------------------------------------------- | -------- | ------ | ------ | ------------ | ---- |
| A   | SkillRegistry 单源化                           | P0 误判  | —      | 0      | ✅ 已完成    | —    |
| B   | Memory 漂移 4 条修正                           | 文档     | P0     | 30min  | ✅ 已完成    | —    |
| C   | Checkpoint 双源消歧                            | P1       | P1     | 4h     | ⏳ 待执行    | —    |
| D   | God class 拆分（2 文件）                       | P1       | P1     | 1-2 天 | 🔄 派工中    | —    |
| E   | Stateless Phase 2（4 P0 + 4 P1 + 5 P2）        | P0-3     | P0     | 2 周   | 🔄 派工中 P0 | —    |
| F   | Leader-chat 接 harness Runner                  | P0-2     | P0     | 1 周   | ⏳ 待执行    | A    |
| G   | Stateless Phase 3（Checkpoint+Event log → PG） | 新差距   | P1     | 1 周   | ⏳ 待执行    | E    |
| H   | Multi-model Transparent Failover               | 业界差距 | P1     | 10 天  | ⏳ 待执行    | —    |
| I   | Dreaming 主动反思机制                          | 业界差距 | P2     | 12 天  | ⏳ 待执行    | E,G  |
| J   | 本作战图                                       | 文档     | P0     | 1h     | 🔄 进行中    | —    |

**总工作量**：约 4-6 周；P0 关键路径 = A(0) + B(0.5h) + E.P0(4 天) + F(1 周) = **2 周**

---

## 二、各 PR 详细方案

### PR-A · SkillRegistry 单源化 ✅

**审计误判修正**：原 arch-auditor 报"P0 双源"是因为 `ai-harness/facade/index.ts:1085` re-export `SkillRegistry`（指向 engine）。实际上：

- harness 侧 class 名已是 `BuiltinSkillCatalog`（`skill-registry.ts:28`，注释 L1-22 明确改名理由）
- `BuiltInReActSkillRegistry` 是兼容别名
- facade re-export `SkillRegistry` 是合理"桥接"——ai-app 可以单一 facade 拿到 engine 侧的 DB-backed SkillRegistry，不必直接 import engine
- ai-app 内 16 处 import 都正确（office/slides/custom-agents 等）

**唯一可选优化**：`reference_two_skill_registries.md` memory 已有，将 2026-05-15 复核结果回填到该 reference。

---

### PR-B · Memory 漂移修正 ✅

修正 3 条 memory：

1. `project_playground_r2c_complete_2026_05_04` — 添加"R2-C 不删 simple-loop，chapter-reviewer 仍在用"复核
2. `project_harness_stateless_phase9_2026_04_30` — 添加"Phase 1 只迁 1 条链路，14 处 Map 待 Phase 2"复核
3. `project_skill_sediment_2026_05_01` — 添加"class 已改名 + agent 仍未真消费 getSkill()"复核

---

### PR-C · Checkpoint 双源消歧

**问题**：harness 下有两套 Checkpoint：

- `memory/checkpoint/CheckpointService` — react-loop 级，agent 粒度（每个 ReAct 步骤 snapshot）
- `memory/mission-checkpoint/MissionCheckpointService` — mission 级，业务粒度（每个 stage snapshot）

两套独立 interface + 独立 store + 独立 spec，使用方需判断"用哪个"，违反 MECE。

**方案**：保持职责分离但消歧名称

- `memory/checkpoint/` → 改为 `memory/agent-step-checkpoint/`，service 名 `AgentStepCheckpointService`
- `memory/mission-checkpoint/` 不动
- 文件顶部加注释明确"两套并存的理由 + 各自语义"
- facade export 增加注释表头

**工作量**：4h（改 import 路径 + 测试 + 文档）

---

### PR-D · God class 拆分（侦察清单已就绪）

**文件 1**：`per-dim-pipeline.util.ts` 1740 → 460 行

- 拆 `chapter-pipeline.helper.ts`（L709-1255，547 行，runChapterPipeline）
- 拆 `chapter-batch-executor.helper.ts`（L1257-1312，56 行）
- 拆 `chapter-integrity.validator.ts`（L1652-1725，74 行）
- 主文件留：导入 + 类型 + cache hit + outline + integrator + 终态评分

**文件 2**：`mission-store.service.ts` 1741 → 280 行

- 拆 `mission-lifecycle.helper.ts`（completed/cancelled/failed/reopened，325 行）
- 拆 `mission-update.helper.ts`（topic/budget/reset，143 行）
- 拆 `mission-postmortem.helper.ts`（postmortem+rerun patch，182 行）
- 拆 `mission-report.helper.ts`（report versions + research/chapter draft，339 行）
- 主文件留：constructor + create + heartbeat + cleanup + count + list + getById

**风险**：

- `emergencyAborted` Set + `isMissionRowMissing` 私有方法需 protected/export 给 helpers
- `firstUseByChapter` Map 在 runChapterPipeline 外层 init，需作为参数透传

---

### PR-E · Stateless Phase 2（13 处 Map → Redis）

**完整迁移清单**（侦察精确，按优先级）：

**P0（Week 1，4 处必修）**
| 文件 | 字段 | Redis 数据结构 | 工作量 |
|---|---|---|---|
| `guardrails/budget/token-budget.service.ts:65-66` | budgets / usageHistory | INCR + List(LTRIM 1000) | ⭐⭐ |
| `guardrails/rate-limit/rate-limiter.ts:84-85` | entries / configs | ZSET + EX TTL | ⭐⭐⭐ |
| `guardrails/billing/billing-adapter.ts:42` | disabledModels | SET + EX | ⭐ |
| `protocols/events/domain-event-bus.ts:31-33` | throttle / idempotency | SET.EX | ⭐⭐ |

**P1（Week 2，4 处协调一致性）**
| 文件 | 字段 |
|---|---|
| `runner/progress/progress-tracker.service.ts:23-35` | tasks / callbacks |
| `lifecycle/mission-liveness-guard.service.ts:134,143` | adapters / lastWarnedAt |
| `tracing/cost-attribution.service.ts:148,151,154` | hourlyBuckets / userAggregations / budgetConfigs |
| `lifecycle/rerun-lock.registry.ts:18` | locks(Set 嵌套) |

**P2（Week 3+，架构优化）**
| 文件 | 字段 |
|---|---|
| `lifecycle/process-supervisor.service.ts:95` | stateStore 嵌套 Map |
| `memory/consolidation/memory-consolidation.service.ts:61-63` | dream lastRun / sessionCounts / activeRuns |
| `agents/events/agent-event-store.ts:37,42` | seqByAgent / seqLock |
| `lifecycle/ownership-registry.ts:16` | byId |
| `facade/domain/chat.facade.ts:78` | zeroBalanceCache |

**无需迁（合理 in-process）**：14 处—— registries / configCache / 状态机转移表等只读结构。

---

### PR-F · Leader-chat 接 harness Runner

**当前问题**（`leader-chat.service.ts:15` 注释 PR-8 TODO）：

- 直接调 `AiChatService`（engine 层），绕过 harness ReActLoop / AgentExecutorService
- 自建 `CREATE_TODO` 状态机
- `buildLeaderChatPrompt` 内联硬编码 prompt，未走 SkillRegistry

**整改步骤**：

1. 把 `buildLeaderChatPrompt` 内容沉淀为 SKILL.md（`agents/leader/skills/chat.md`）
2. 让 `leader-chat.service` 通过 `BuiltinSkillCatalog.get("leader-chat")` 拿 prompt
3. 替换 `AiChatService` 为 `AgentExecutorService.execute()`，CREATE_TODO 改为 tool call
4. 删除自建状态机
5. 补 spec：leader-chat 在 harness runner 上的完整 e2e

**工作量**：1 周（5 天 dev + 2 天 review/spec）

---

### PR-G · Stateless Phase 3（PG-backed Checkpoint + Event log）

**2026-05-15 复核：机制已就绪，实际工作量 2 小时**

| 组件                             | 现状                                                                                                    |
| -------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `HarnessCheckpoint` Prisma model | ✅ schema:9489 已存在                                                                                   |
| `PrismaCheckpointStore` 实现     | ✅ `memory/checkpoint/prisma-checkpoint-store.ts` 完整                                                  |
| 切换逻辑                         | ⚠️ `harness.module.ts:274` env `HARNESS_CHECKPOINT_PERSIST=1` 走 Prisma；未设默认 in-memory（生产风险） |
| `process_events` Prisma table    | ✅ EventJournalService 已 wire（含 tableReady 防御）                                                    |
| `EventJournalService`            | ✅ `protocols/journal/event-journal.service.ts` 已生产化                                                |

**剩余实际工作**：

1. `harness.module.ts:274` 切换：`NODE_ENV === 'test' && env !== '1'` → in-memory；否则 Prisma
2. 部署文档加 `HARNESS_CHECKPOINT_PERSIST=1` 提示
3. 评估 `InMemoryCheckpointStore` 是否还有生产 caller

---

### PR-H · Multi-model Transparent Failover

**2026-05-15 复核：机制已就绪，实际工作量 2-3 天**

| 组件                          | 现状                                                                                                      |
| ----------------------------- | --------------------------------------------------------------------------------------------------------- |
| `ModelFallbackService`        | ✅ `llm/selection/model-fallback.service.ts` 完整（maxRetries/maxModelSwitches/错误分类）                 |
| `AiChatFailoverCallerService` | ✅ `llm/services/ai-chat-failover-caller.service.ts` 已实现 BYOK 链路 failover                            |
| chat() failover 接入          | ⚠️ `ai-chat.service.ts:789` 仅 BYOK 路径（userId + failoverCaller）走 failover；admin/system key 路径不走 |
| `KeyHealthService` cooldown   | ✅ 已有 key-level cooldown                                                                                |
| Cost tracker on failover      | ✅ 已记录真实 provider                                                                                    |

**剩余实际工作**：

1. 让非 BYOK 路径（admin / system key）也走 ModelFallbackService
2. grep `aiChatService.chat` 全量入口，确认每个都有 failover hook
3. 跨用户 admin key 失效切换补 logging

**2026-05-15 caller audit 结论**：

- ✅ `ChatFacade.chat()` 自动接通 model failover（chat.facade.ts:193 chatWithFallback 分支）
- ⚠️ 4 处 ai-app 直接调 `AiChatService.chat()`，缺 model failover（但有 BYOK key failover 兜底）：
  - `agent-playground/services/chat/leader-chat.service.ts:137` — single-turn chat 决策路由
  - `writing/content-engine/services/sliding-window-context.service.ts:310, 422` — 上下文压缩 2 处
  - `writing/content-engine/services/quality-monitor.service.ts:469` — 质量监控
  - `library/knowledge-graph/knowledge-graph.controller.ts:279` — KG 抽取
- **建议（非阻塞）**：渐进迁移这 4 处到 ChatFacade，每处 ~10 LOC（改 import + 改 inject 类型），spec 兼容。优先级：leader-chat > writing > KG（按调用频次）

---

### PR-I · Dreaming 主动反思

**业界最大差距**：Anthropic MA 有定期 Dreaming（跨 mission 周期反思失败规律，沉淀为通用规则）；GenesisPod 当前只有被动 Postmortem→VectorMemory。

**整改**：

- `ai-harness/evaluation/` 新增 `ReflectionMissionScheduler`（cron 6h/24h）
- 抽样 N 个失败 mission，喂给 reflection-agent（用 critique-agent skill）
- 生成 `RuleBase` 条目（"X 类失败 → Y 修复路径"）
- 下轮 mission 启动时，从 RuleBase 取 top-K 注入 leader plan
- 配套 admin UI：RuleBase CRUD + 反思历史

**依赖**：PR-E + PR-G（state 都外置后才能跨 pod 周期反思）。

**工作量**：12 天（确实是新能力，无既有机制）。

---

## 三、关键路径与里程碑（2026-05-15 重新校准）

**重大发现**：审计估的 PR-G/H 工作量被高估 5-10 倍——机制都已就绪，缺的是默认开关 + 完整度接通。整改实际总工作量从原估 4-6 周缩到 **2 周**（不含 PR-I）。

```
Day 1: PR-A ✅ + PR-B ✅ + PR-J ✅ + PR-C ✅ + PR-D ✅ + PR-E.P0(4 项) ✅ + PR-F ✅
        本 session 已完成 → 架构 7.2→8.3，标杆 82→88，业界 95→102
Day 2: PR-E.P1(4 项 sub-agent 派工中) + PR-G(2h env 切换) + PR-H(2-3d)
        → P0/P1 全清；标杆 88→94；业界 102→108
Week 2: PR-E.P2(5 项) + 评审 + push
        → Stateless 完整；架构 8.3→9.0；业界 108→110
Week 3-4: PR-I(Dreaming) — 真新能力
        → 业界 110→115（对 Anthropic MA 95%+）
```

## 四、看护机制

每个 PR 必须满足：

1. **测试**：spec 行数 ≥ 改动行数 × 0.5
2. **覆盖率**：jest coverage 不掉 85% / 75% 门槛
3. **架构 spec**：`npm run verify:arch` 0 violation
4. **集体评审**：≥ 4 路评审 4/4 共识后才推（按 `feedback_implementation_rounds_need_review_too`）
5. **commit pathspec**：多 session 并行场景必须 `git commit -- pathspec`（按 `feedback_multi_session_must_use_pathspec_commit`）
6. **沉淀 memory**：每 PR 落地后必须更新 `MEMORY.md` index

## 五、退出标准

整改完成 = 同时满足：

- arch-auditor 全 12 维度 ≥ 8/10
- 标杆评估 ≥ 95/100
- 业界对标 ≥ 110/120（一线水准）
- 0 个 P0、≤ 2 个 P1 follow-up
- 全量 spec 绿 + 全量 verify:arch 绿 + 0 god-class
- 至少 1 个新 ai-app（如 debate-team）通过 invariants.md 全部 8 项

---

**作战指挥**：主 Agent 统筹，并发 sub-agent 实施单一聚焦 PR，集体评审 4/4 共识门，分批 push。
