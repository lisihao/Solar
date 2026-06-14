# AI 分层 MECE 审计 + 整改记录（2026-06-02）

> 范围：ai-infra (L1) / ai-engine (L2) / ai-harness (L2.5) 三层边界与 MECE 合规。
> 方法：13 路 arch-auditor 并行调查 + 对抗性验证（109 个 agent，63 条经代码核实，30 条被驳回）+ 2 路 SOTA 对标。
> 结论：**宏观结构正确（6.8/10），问题是"未完成的整合"而非"错误的分层"**。

---

## 一、总评

L1/L2/L2.5 的"无状态基元 → 引擎基元 → 有状态编排"切分与业界 SOTA（OpenAI Agents SDK / LangGraph / LlamaIndex）收敛的 seam 一致。最重要的不变量"engine 不知 agent/mission、harness 知道"方向正确，绝大多数地方守住了。`handoffs/`、引擎/harness 基元切分、ai-infra DIP token（`IAiChat`/`IAiObservability`）均 SOTA 对齐。

拖低分的三个反复模式：

1. **理想化基元零消费方**：`ai-infra/resilience/{CircuitBreaker,AbortableScope}` 建好但无人 import，要消灭的重复反而长出 ≥4 个熔断实现。
2. **单表三写扇出**：一次 LLM 调用从 3 条独立路径写 `aIEngineMetric`，守护是 honor-only。
3. **文档漂移**：CLAUDE.md 说 engine 10 聚合且含 credentials；实际 12 个且 credentials 一个月前已迁 L1。

---

## 二、已完成整改（本 PR，安全 + 已验证）

| 项                                  | 内容                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | 验证                                                                                                                                                                                                                             |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D1/D2/D3**                        | CLAUDE.md + ai-engine/README.md + routing.module.ts JSDoc：engine 聚合 10→**12**（补 routing/reliability/evaluation），credentials 标注已迁 L1                                                                                                                                                                                                                                                                                                                                                                                           | 文档一致性                                                                                                                                                                                                                       |
| **D6**                              | `.eslintrc.js`：ai-app→engine facade 守护按"子目录"枚举大量漂移成死规则（agents/core/teams/credentials/orchestration/mcp/api/runtime/knowledge.rag/... 14 处不存在），新顶层聚合 rag/routing/reliability/evaluation **从未被守护**。新增 SECTION 11"12-聚合 catch-all"按聚合根枚举一次补齐；open-api 块删死的 credentials path + 补 routing/reliability/evaluation                                                                                                                                                                       | `node -e require` 解析通过；ai-app 非 \*.module.ts **0 处**穿透这些路径（验证后零新违规）                                                                                                                                        |
| **P0-1（守护部分）**                | 新增 jest arch spec `Engine mission-state isolation (MECE inv.1)`：ai-engine/\*_ 不得访问 mission/agent-scoped Prisma 表（`prisma.mission_`/`prisma.agentPlayground\*`）。把 honor-only 不变量升级为强制                                                                                                                                                                                                                                                                                                                                 | `verify:arch` 全绿；regex 经验证能检出真违规                                                                                                                                                                                     |
| **P0-1（真修，relocation 已完成）** | `MissionElectionTracker` + `MissionElectionReservation` 自 `ai-engine/llm/selection` **迁至 `ai-harness/guardrails/runtime`**（与 MissionTokenLedger 同址）。provider 注册到 @Global `RuntimeResourceModule`（显式 import PrismaModule + @Global CacheModule → Prisma/Cache 保证可注入）；从 engine `LlmModule`/`selection/index`/`facade` 摘除；7 个 harness 消费方 + 2 spec 改指新路径；ai-app 3 个消费方**零改动**（harness facade repoint）。无状态 `ModelElectionService` 留 engine。arch spec **allowlist 清零**，对全 engine 强制 | `tsc --noEmit` **0 error**（全仓）；arch 全绿（空 allowlist）；harness-module 集成 spec **72 pass**（DI 解析通过）；engine model-election spec 通过。**待用户 Railway 验证**：mission 模型多样性（@Optional 注入漏接会静默失效） |

> **设计说明**：D6 采用"additive catch-all"而非重写 877 行治理文件 —— 旧 SECTION 1-9 死规则保留（匹配为空、无害），其具体报错信息对存活路径仍有指引。死规则清理列为独立 follow-up。

---

## 三、待整改（runtime-sensitive，需 Railway 验证 + 逐项确认）

> 共同点：全部触及 LLM 调用 / agent 执行 / 工具韧性 / 报告生成等运行时敏感路径，按 CLAUDE.md"运行时验证"红线需远程环境实测，不宜盲改。

### P0-1 关键修复：relocate `MissionElectionTracker` engine→harness（已 de-risk，待执行）

- **现状**：`ai-engine/llm/selection/mission-election-tracker.service.ts:90` 直接 `this.prisma.missionElectionState.findUnique`，表对 ai-app 的 `agent_playground_mission` 有硬 FK —— engine 藏 mission 状态。
- **已验证可行**：① `ModelElectionService` **不注入** tracker（通过 caller 传 `previouslyElected` 解耦，line 292 注释明示）；② **无任何 ai-engine 消费方注入** tracker，仅 harness（agent-factory/harness.module）+ ai-app（agent-playground ×3）；③ 该服务仅依赖 `@/common/`（Cache/Prisma），层无关 → **迁移不产生反向依赖**。
- **执行计划**：
  1. 移动文件至 ai-harness（建议 `ai-harness/lifecycle/mission-lifecycle/` 或 `runner/` 下），内容逐行搬，无需改 import（仅 common）。
  2. 从 `ai-engine/llm/llm.module.ts` 摘除 provider/export；从 `ai-engine/facade` 摘除 export；从 `ai-engine/llm/selection/index.ts` 摘除。
  3. 在对应 harness module 注册 provider + export；harness facade 已有引用，改指向新路径。
  4. 更新 6 个消费方 import 路径（agent-factory / harness.module / agent-playground controller+pipeline+module）。
  5. 移动 spec 文件；删除新 arch spec 的 allowlist 条目（届时全 engine 强制）。
- **风险**：tracker 为 `@Optional()` 注入 → DI 漏接**不崩溃但 election 多样性静默失效**（模型收敛单一），type-check 抓不到 → **必须 Railway 跑一次 agent-playground mission 看模型多样性**。

### P0-2 熔断器 ≥4 实现合一

`ai-infra/resilience/CircuitBreaker`(0 消费)、`ai-engine/reliability/entity-health`、`ai-harness/runner/tool-invoker/tool-circuit-breaker`、`agent-executor.service` 内联第 4 份。enrich infra 基元到 3-state，其余 compose（`EntityHealthRegistry` 因依赖 Redis/HookBus 不能下沉 L1，只 compose 状态机 core）。**需工具/agent 执行路径运行时验证**。

### P0-3 可观测三写合一

`AIMetricsService.recordLLMMetrics`（同步）+ `AiObservabilityService`（异步 `llm_call`）写两行不同 UUID（`skipDuplicates` 不去重）+ `CostAttributionService` 第三行 `cost_event`。令 `AiObservabilityService` 为 `llm_call` 唯一权威，从 `AiChatService` 热路径摘除 `AIMetricsService.recordMetric`。**直接影响计费/成本看板，必须 Railway 验证读路径 metricType 过滤**。

### P1（中等价值）

- **P1-2** 删 TI citation 重复（`ai-app/topic-insights/.../report/citation-formatter.service.ts`），callers 走 engine facade canonical 纯函数（会修复 TI 副本缺失的 multi-author + phishing-domain 两个 bug → **改变报告输出，需验证**）。验证修正：`knowledge/evidence` 那份**不是**重复（输入模型不同），勿动。
- **P1-3** 重命名 `evaluation` 同名碰撞：engine→`quality-checks`，harness→`reflection`（或显式文档化 altitude 边界）。
- **P1-4** harness `guardrails/{budget,billing,resources}`→`resource-limits/`，把 `guardrails` 让回 engine safety 的 tripwire 语义（对齐 OpenAI SDK）。
- **P1-5** wire `AbortableScope` 到 3 处裸 `addEventListener("abort")`（`harnessed-agent.ts:217` + 2 reranker adapter），然后把 ESLint `no-naked-abort-listener` warn→error（**必须先修后升级否则 lint 失败**）。

### P2（hygiene）

P2-1 抽共享 scorer 常量（`ModelElectionService` ↔ `routing/signal-scorers.ts` 字节一致会漂移）· P2-2 删 `LlmTracingService` stub · P2-3 `tracing.decorator` 模块级数组→`AsyncLocalStorage`（并发 bug）· P2-4 删死 `MissionTokenLedger` 注册（**注意 `TokenBudgetService` 命名地雷**：harness 的 `MissionTokenLedger` 别名 vs engine 的 `ContextBudgetCalculator` 别名，ai-app 消费方全解析到后者）· P2-5 `RERANK_MODEL` 硬编码→ConfigService · P2-6 `rag/` module 归属决策 · P2-7 `ISkill`/`SkillRegistry` 同名碰撞重命名 · P2-8 `ContextBudgetCalculator` 静态目录补 DB。

---

## 四、明确不要动（验证驳回，防 churn）

- **保留** `ai-infra` 命名与位置：两条"改名 platform"建议被驳回。`ai-` 是层命名空间约定（ai-app/engine/harness/infra），非"每个文件都是 AI 基元"；这是**产品平台**非 OSS 库，auth/billing/credentials 放 L1 自洽（credentials 解析零 agent/mission 状态）。
- **保留**双 checkpoint 拆分（`memory/checkpoint` vs `mission-checkpoint`）：类型零重叠、消费方不相交，合并会泄漏 harness 内部到 L3。
- **保留** `routing/` 在 engine：与 `llm/selection` 零耦合，2 个 live 非-LLM 消费方（SemanticSkillRouter/SemanticToolSelector）。
- **保留** `reliability`/`evaluation`/figure 拆分：均为合法 L2 extract / L2.5 relevance。

---

## 五、SOTA gap（结构性）

1. `guardrails` 跨层歧义（engine=安全 tripwire vs harness=资源配额）—— OpenAI SDK 里 guardrail 专指 tripwire。→ P1-4。
2. `evaluation` 顶层同名 ×2 —— 违反项目自身唯一性规则（拆分对、名字错）。→ P1-3。
3. 无一等公民 `Session`/thread 概念 —— 会话状态散在 memory/{working,stores,checkpoint} + runner/context。→ 需决策。
4. durable execution 非一等关注（resilience/reliability 跨层近义词），多数非-Temporal 框架同样如此，中度 divergence。

---

**整改分支**：`refactor/ai-layer-mece-remediation`
**已验证**：`verify:arch` 27/27（新 spec 含在内）；一处 pre-existing 失败 `audit-capability-anti-patterns`（与本次无关，stash 验证确认）。
