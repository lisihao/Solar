# AI 平台分层迁移蓝图（W1–W3 三波）

> **日期**：2026-06-03
> **来源**：Workflow `wf_4351b0fa-140`（28 agent / 2.07M tokens / 756 工具调用）—— 9 域并行深核现状 → 目标端口设计 → **对抗校验 MECE（9 域全 needs-fix，已吸收修正）** → 首席综合
> **配套**：本文是 [2026-06-03-capability-mece-sandbox.md](2026-06-03-capability-mece-sandbox.md)（分层原则与决策树）的**可执行迁移计划**
> **重要**：对抗校验推翻了初版设计的多处关键假设(见下"校验修正纪要")，本蓝图为修正后版本

---

## 校验修正纪要（对抗校验 MECE 推翻的设计错误）

初版目标设计在 9 个域全部被独立怀疑者判 needs-fix,其中 4 处是**读源码实证的硬错误**,必须知道:

1. **D-evaluation 方向反了(最严重)**：初版要"删 TI 副本、切到 harness 权威"。实测相反——TI `topic-insights/services/quality/*` 是 **LIVE 权威(5+ DI 消费方)**,harness `evaluation/critique/*` 才是 **0-consumer 参考副本**,且两份文件实际 DIFFER。修正：TI 原地保留,删/降级 harness 副本。**若按初版执行会回归生产**。
2. **G-planning 命名错了**：初版改名 `event-planning`,但该模块是 8 模板通用策划平台(event 仅 1/8)。修正：改 `ai-planning`(与 HTTP 前缀/前端一致),类名 `AiPlanningModule` 保持以缩小改名面。
3. **H-ingestion 不是低风险**：实有 **5 处** explore 反向依赖(初版只认 2 处),且必须"移动+全部反转同 PR 原子交付",否则 verify:arch 中途必 RED。已从 W1 移到 **W3**。
4. **F-teams 4 处实证错**：`MissionContextService/MissionInputService` 实为**无状态**(应落 L2 engine 非 harness);`TaskDecomposition` 已存在于 writing 模块(新建必撞名);mission-types.ts 全 Prisma 派生(无法干净剥离,删除伪搬迁步)。
5. **端口归属普遍放反**：A(凭证)/B(可观测)端口初版放消费层,应**随被实现方下沉**——凭证端口落 L1 `platform/credentials/abstractions/`(复刻 AI_CHAT_TOKEN 范式),span-exporter 端口落 L0 `plugins/core/abstractions/observability/`(复刻 storage 端口先例)。

---

## 一、总览表（每域：目标归属 / 决策树依据 / 风险 / 波次 / MECE 裁决）

| 域                   | 目标归属                                                                                                         | 决策树依据                                              | 风险    | 波次  | MECE 裁决（修正后）                                                                                                                                                                   |
| -------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. BYOK/凭证/密钥    | L1 `platform/credentials/`（合并 engine/credentials + platform/{secrets,encryption,key-health}）                 | Q3a 是：KEK provider 可替换后端、零 agent/mission 状态  | XL      | W3    | ①端口应落 **L1 platform/credentials/abstractions/**（复刻 AI_CHAT_TOKEN）非 L2；②遗漏 ai-harness 5 个消费者，真实消费者 73 文件非 72                                                  |
| B. 可观测性          | L1 `platform/monitoring/` + **L0 `plugins/core/abstractions/observability/`**（端口）+ L2.5 harness/tracing 原地 | L1=进程内聚合；L0=可换 exporter；L2.5=agent-aware trace | medium  | W1    | ①span-exporter 端口应落 **plugins/core/abstractions/observability/**（与 storage 端口同构）；token 用 `defineServiceToken` unique symbol；②删 `app.module` SPAN_EXPORTER_TOKEN 死绑定 |
| C. 限流/韧性         | L1 `platform/resilience/`（token-bucket 基元）+ L2 engine/reliability（RPM 策略 + entity-health 原地）           | token-bucket=通用韧性基元；RPM 策略消费 L1 store 端口   | low     | W1    | ①漏改 `reliability/index.ts:11` re-export（编译断）；②circuit-breaker 双实现记后续待办                                                                                                |
| D. evaluation        | L2 engine/evaluation（checker 原地）+ L2.5 harness（verify→**quality-judge** 改名）                              | engine=无状态 checker；harness=LLM-judge                | medium  | W1    | （方向反转）**TI quality 是 LIVE 权威，harness/critique 是 0-consumer 副本**。删/降级 harness 副本、TI 原地保留                                                                       |
| E. routing/selection | L2 engine/routing（共享 rankBySignals 纯函数）+ engine/llm/selection（ModelElection 适配器）                     | Q4 否：elect() 无运行时状态                             | medium  | W2    | SignalScorer 窄端口载不动 role/tier。采用**方案 B**：rankBySignals 泛型化 `<C,Q>`                                                                                                     |
| F. teams             | L2.5 harness/teams/collaboration + L2 engine（无状态抽象）+ L3 app（Topic 业务）                                 | 分域裁定                                                | high/XL | W2→W3 | ①MissionContext/InputService **无状态→L2 engine**；②`TaskDecomposition` 撞名→改名/放弃；③mission-types 全 Prisma→删伪搬迁步；④仅 MissionStateManager 上迁 harness                     |
| G. planning          | engine/planning 原地 + app/planning **改名 ai-planning**                                                         | engine=无状态推理基元；app=业务状态机                   | low     | W1    | **event-planning 命名错误**（8 模板仅 1/8）。改 `ai-planning`，类名保持；补漏 dto/+根 `__tests__`                                                                                     |
| H. 错位小模块        | notifications-bridge 原地 L3 + ingestion → L1 `platform/data-ingestion/`                                         | bridge 依赖 L2.5 不可下沉；ingestion=通用采集基元       | high    | W3    | ①ingestion **5 处** explore 依赖；②**移动+反转同波原子**；③DashboardController 同样双份需消歧                                                                                         |
| I. storage           | L1 `platform/storage` + L0 plugins/storage + L0 abstractions                                                     | PSB 模式已是目标态                                      | low     | W1    | （仅证据/守护）①@Global 模块由 storage.module/knowledge.module import 非 app.module；②拓扑 spec 范围扩到 `ai-engine/**`+`platform/**`                                                 |

---

## 二、三波执行计划

### 波次编排原则

- **W1（低风险归位 + 证据修正）**：B/C/D/G/I 五域。无跨层重依赖、可独立绿色交付。
- **W2（同层去重 + 协作上迁）**：E/F（协作基础设施 + MissionStateManager）。
- **W3（XL 跨层收敛，原子交付）**：A（凭证全栈）/F（engine 无状态抽象，已砍掉伪搬迁）/H（ingestion 移动+全部反转同波）。

### W1 — 低风险归位与证据修正

**前置依赖**：无（基线波）。开工先 `npm run verify:arch` 留绿色基线。

**PR-W1-1 · 可观测性归位（B）**

- 迁 `common/observability` 5 文件 + `__tests__` → `platform/monitoring/{metrics,tracing,events}`；`MetricsService`→`PrometheusMetricsService`。
- span-exporter 端口提升至 **`plugins/core/abstractions/observability/span-exporter.port.ts`**；`SpanData`→`TelemetrySpanData`；token 用 `defineServiceToken<ISpanExporter>("plugin.service.span-exporter")`。
- telemetry-otel plugin 改 import 该 L0 端口并 implements；删 plugin 内旧 `span-exporter.interface.ts`。
- **不**在 app.module 绑 SPAN_EXPORTER_TOKEN（plugin 走 loader/PluginRegistry，非 Nest DI）。
- 合并 ObservabilityModule providers 进 MonitoringModule，删 `common/observability/{observability.module,index}.ts`。
- verify：`type-check` → grep `common/observability` 0 残留 → `jest plugins/observability/telemetry-otel` → `verify:arch`。

**PR-W1-2 · token-bucket 下沉（C）**

- `git mv ai-engine/reliability/rate-limit/token-bucket.ts → platform/resilience/token-bucket.ts`；抽 `ITokenBucketStore` 到 `platform/resilience/abstractions/token-bucket.port.ts`。
- **必修**：移除 `ai-engine/reliability/index.ts:11` 与 `rate-limit/index.ts` 对 `./token-bucket` 的 re-export（否则 type-check 断）。
- `rate-limit.service.ts` import 改 `@/modules/platform/resilience`；Redis key 前缀**保留 `engine:`**（零中断）。
- circuit-breaker 统一登记为后续波次待办（OI-C1）。
- verify：`type-check`（捕获 barrel 断裂）→ `jest ai-engine/reliability/rate-limit + platform/resilience` → `verify:arch`。

**PR-W1-3 · evaluation 改名 + 反向去重修正（D）**

- harness `verify/`→`quality-judge/`，`JudgeService`→`QualityJudgeService`（更新 harness.module 4 处 + facade 1 处 + skill-learning/reflexion/simple-loop 引用）。
- 3-way `QualityGateService` 消歧：search/fusion→`SearchFusionQualityGateService`、writing→`WritingQualityGateService`（engine 侧保留唯一 `QualityGateService`）。
- **方向修正**：TI `services/quality/*`（LIVE 权威）**原地保留 L3 私有**；删除/降级 harness `evaluation/critique/` 下 6 个 0-consumer 副本以消除 `ReportQualityGateService` 双份。**禁止删 TI 切 harness**。
- verify：grep `class QualityGateService` 仅剩 engine 一处 → grep `class ReportQualityGateService` 仅剩 TI 一处 → `jest ai-harness/evaluation/quality-judge + ai-app/topic-insights` → `verify:arch`（layer-4-vocabulary）。

**PR-W1-4 · planning 改名（G）**

- `git mv ai-app/planning → ai-app/ai-planning`（目录名用 `ai-planning` 消除目录 token 同名）；类名 `AiPlanningModule` 等**保持不变**（最小改名面）。
- **补漏 fileMoves**：`dto/`（create-plan/update-plan/replan/index）4 文件 + 模块根 `__tests__/planning-orchestrator.service.spec.ts`（与 services/**tests** 下非同一文件）。
- `@Controller("ai-planning")` HTTP 前缀**不改**；`PLANNING_TEAM_CONFIG` teamId 字符串值**不改**。
- verify：`type-check` → grep 全仓无 `ai-app/planning/` 路径残留 → `jest ai-app/ai-planning` → `verify:arch`。

**PR-W1-5 · storage 不变量固化（I）**

- 不动 wiring。增 `offload-prefixes.spec.ts` 双向集合相等断言。
- 新增架构 spec `storage-port-topology`：断言 **`ai-engine/**`与`platform/**`** 均不得 import `plugins/storage/(object-r2|vector-pgvector|vector-jsonb|*.module)` 具体路径，仅允许 `plugins/core/abstractions`；对 `knowledge.module.ts:24`、`storage.module.ts:13` 两个 @Global 装配点显式 allowlist。
- 修 README stale（`ai-infra`→`platform`、`ObjectStorageService` vs `R2StorageService`）；`R2StorageService`→`ObjectStorageService` 改名记债（OI-I1）。

**W1 波末门**：`npm run verify:full`（lint+type+test+build）。

### W2 — 同层去重与协作上迁

**前置依赖**：W1 全绿。

**PR-W2-1 · ModelElection 同层去重（E，方案 B）**

- 抽 embedding-free 纯排序为**泛型** `rankBySignals<C,Q>(items, query, scorers)` → `ai-engine/routing/rank-by-signals.ts`（纯函数，零 DI，**禁** llm.module import routing.module，规避 llm→routing→knowledge→llm 三角循环）。
- election 自定义富类型 `ElectionScorerCtx`（含 config/tier/targetTier/role）；health/cost/diversity/priority **复用打分常量/阈值**（函数体可重写，数值逐档对齐黄金快照）。
- **强成功标准**：黄金快照 → breakdown 各键逐一相等；增"两候选仅 isDefault 不同时 winner 一致"断言。

**PR-W2-2 · teams 协作基础设施上迁（F，已按 MECE 修正）**

- 上迁 **MissionStateManager**（确有运行时状态）→ `harness/teams/collaboration/context/`。
- **MissionContextService / MissionInputService 落 L2 engine**（实测无状态）：建议 `ai-engine/teams-primitives/`。开工前读源码二次确认 MissionInputService 依赖落点。
- **删除 IMissionContextAssembler 端口整套 wiring**（伪问题）。
- VotingManager/HandoffCoordinator/MissionPipeline 迁回 `harness/teams/collaboration/`；CRUD 留 app。

**W2 波末门**：`npm run verify:full`。

### W3 — XL 跨层收敛（原子交付）

**前置依赖**：W1+W2 全绿。

**PR-W3-1 · 凭证全栈收敛 L1（A，XL）**

- 建 `platform/credentials/` + `credentials.module.ts`；**IKeyProvider + KEY_PROVIDER_TOKEN 放 `platform/credentials/abstractions/key-provider.port.ts`（L1，复刻 AI_CHAT_TOKEN）**。
- 分批 git mv：①薄适配（user-api-keys/user-secrets/key-assignments/key-requests/user-model-configs/scheduling/authorization）→ ②`platform/{secrets,encryption,key-health}`（EncryptionModule 保持 @Global）→ ③KeyExecutor/KeyResolver/ToolKeyResolver。
- 端口反转：app.module 绑 `{ provide: KEY_PROVIDER_TOKEN, useExisting: KeyExecutorService }`；engine 三处核心消费者改注入端口，其余仅改 import。
- **补齐遗漏的 ai-harness 5 个消费者**（73 文件非 72）：`facade/index.ts:1375-1379` re-export、`model-resolver.service.ts`、`domain/chat.facade.ts`、`guardrails/resources/resource.module.ts`、`guardrails/runtime/runtime-environment.service.ts`；增 `jest ai-harness/facade` 验证门。
- 删 engine facade 782-819 credential re-export；ai-app/byok + open-api/byok-admin 改直引；更新 `.eslintrc.js` 豁免 glob。

**PR-W3-2 · teams 无状态抽象（F，按 MECE 大幅缩减）**

- **删除原波3 engine 抽象提取整步**（mission-types 全 Prisma 派生 + TaskDecomposition 撞名）；mission-types 原地留 app。
- 仅清理 W2 上迁后残留 re-export + 确认 5 处 registerConfig 无回归。

**PR-W3-3 · ingestion 移动 + 全部反转（H，单波原子）**

- **同一 PR 内**完成物理移动 + 全部依赖反转。git mv 4 子目录 → `platform/data-ingestion/`，类名加 `DataIngestion*` 前缀。
- 消歧双份：`SourcesDashboardService/Controller` vs `IngestionConfigDashboardService/Controller`。
- **端口反转（5 处）**：IUrlClassifierChat / IResourceLifecycle / IResourceWriter / **IContentEnrichment（hackernews→AIEnrichmentService）** / **LINK_HEALTH 常量 + precheckYoutubeUrl util 移 common**。
- notifications-bridge **不动**。`management/` 仅剩 workspace（OI-H1）。
- verify：**`verify:arch` 单 PR 内必须绿**。

**W3 波末门**：`npm run verify:full` + 逐文件 `git diff` 审查无越权。

---

## 三、看护固化：不变量升级为 spec/lint

| 不变量                                                                     | 升级类型        | spec/lint 落点建议                                                                                     |
| -------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------ |
| 同名唯一（顶层 export class/interface 全项目唯一）                         | **spec**        | 扩 `layer-4-vocabulary`：扫顶层符号建唯一性索引，重复即 fail                                           |
| 一能力一家（credentials/SkillRegistry/checkpoint/circuit-breaker 单权威）  | **spec**        | 新增 `layer-capability-singleton.spec`；circuit-breaker 先入 known-debt allowlist                      |
| 依赖方向（platform 不 import ai-app/ai-harness；engine 不 import harness） | **spec+lint**   | 已有 `layer-boundaries.spec:211`；补 `.eslintrc` `platform/**` 不得 import `ai-app/**`/`ai-harness/**` |
| storage 端口隔离                                                           | **spec**        | PR-W1-5 新建 `storage-port-topology`，范围扩 `ai-engine/**`+`platform/**`                              |
| plugin → platform 反向                                                     | **lint**        | `.eslintrc.js:728-786` 补 `plugins/**` 不得 import `platform/**`                                       |
| Claude Code v2.1.88 反向洞察 10 条                                         | honor→部分 spec | 高频项（#1/#4）升 runner 单测                                                                          |

---

## 四、业界最佳实践对标小结

- **凭证编排 vs LiteLLM**：key/budget 属底层平台资源，L1 落位正确；端口随被实现方下沉到 L1（IKeyProvider 放 platform/credentials/abstractions），与 LiteLLM provider abstraction「接口住消费侧更低层、实现热插拔」一致。
- **durable/编排 vs Temporal/LangGraph**：Temporal 区分 stateful workflow vs stateless activity；据此 MissionContext/InputService 无状态→L2 engine，仅 MissionStateManager→L2.5 harness；不为搬迁发明新契约（删 mission-types Prisma 伪剥离）。
- **可观测 vs OTel 语义**：OTel SpanExporter 是 SDK 中立契约，由 exporter 实现、SDK 消费、配置可插拔。据此 span-exporter 端口放 **plugins/core/abstractions/observability**；L1 进程内 metrics/audit/health = Prometheus client 模式；L2.5 agent-aware trace = LangGraph reflection / OpenAI Agents SDK 执行链 trace。
- **routing vs LiteLLM Router**：rankBySignals 纯函数核 + diversity 状态外置 harness 同构；方案 B 用富类型 ctx 承载 role/tier，避免污染通用 routing 端口。
- **storage PSB**：Port-Selector-Backends 等同 LiteLLM provider abstraction / LangGraph BaseStore / Temporal DataConverter。改进点：backend 选择宜显式 `STORAGE_BACKEND=r2` 配置而非遍历 isAvailable（记债）。

---

## 五、风险与不可逆点清单（主 Agent 手动执行项）

| 项                                                                                                                          | 波次    | 不可逆/手动原因                                 | 处置                                          |
| --------------------------------------------------------------------------------------------------------------------------- | ------- | ----------------------------------------------- | --------------------------------------------- |
| **`app.module.ts` 改动**（B 删 ObservabilityModule；G 改 ai-planning；A 绑 KEY_PROVIDER_TOKEN+12 处 import；H 改路径/类名） | W1/W3   | 入口文件，Sub-Agent 禁改；DI 绑定错误致启动失败 | **主 Agent 手动逐行**，改后 `nest build` 冒烟 |
| **`.eslintrc.js` 改动**                                                                                                     | W3+看护 | 全局 lint 配置                                  | 主 Agent 手动，改后全仓 lint 验证             |
| **新增/修改架构 spec**                                                                                                      | W1+看护 | 误配阻断所有 PR 合并门                          | 主 Agent 手动，先本波子集 dry-run             |
| **Redis key 前缀**（C）                                                                                                     | W1      | 改前缀=限流计数温和重置                         | 决定**保留 `engine:`**，不改                  |
| **HTTP 路由前缀 / teamId**（G）                                                                                             | W1      | 前端契约+registry 运行时契约                    | **值不改**，仅改 TS 标识符                    |
| **prisma**                                                                                                                  | 全波    | 本次迁移**无 schema 变更**（纯代码归位）        | 无手写 SQL 迁移需求                           |

> 全程：Sub-Agent prompt 必须带白名单 + 相关 DTO/Prisma 上下文；完成后逐文件 `git diff` 审查；回滚一律文件粒度，禁全局命令。

---

## 附录：needs-fix 待办清单（OI）

- **OI-C1**[后续]：circuit-breaker 双实现（platform/resilience CircuitBreaker 计数窗口 + engine EntityHealthRegistry 三态机）须统一为单权威；过渡期边界 L1=单 entity 通用熔断 / engine=多 entity 健康注册+selectBest。
- **OI-G1**[P3]：planning 两份同名 `planning-orchestrator.service.spec.ts`（根 **tests** 1508 行 vs services/**tests** 1217 行）内容不同，确认陈旧遗留。
- **OI-G2**[P3]：planning 跨 App 依赖（AiTeamsModule + research RESEARCH_LEAD_ROLE_CONFIG）已知债。
- **OI-H1**[范围]：ingestion 迁出后 `management/` 仅剩 workspace，父目录归属另行交代。
- **OI-I1**[债]：`R2StorageService`→`ObjectStorageService` 改名；backend 选择宜显式配置 env。

---

## 执行进度（2026-06-03 落地回填）

第二轮 workflow（`wf_9e369f4d-1c0`，11 agent）为剩余波次出了 current-source-verified 执行套件 + 对抗校验，5 域全 needs-fix，又抓出多处硬错（A 漏 34 测试+9 facade 间接消费方/facade 段实为 770-819；H 前提自相矛盾；F facade 未导出 3 个 Mission 服务+目标目录不存在；I eslint 规则与既有 685-726 冗余；D 同名实为 5 个非 6）。落地顺序按安全度 **I → D → H → A → F**。

| 波次                                            | 状态                  | commit / 决定                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W1-2/4/B.1/B.2                                  | ✅ 合 main            | PR #230                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| W2-E（路由公式去重，安全切片）                  | ✅ committed          | `d2caa6da1`（election golden 字节不变；cost 分歧保留；generic-ranker 全量 swap 仍 defer）                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **W1-I**（platform/\*\* storage 守护 + README） | ✅ committed          | `405135606`（只加 platform 新覆盖，ai-engine/harness 已有规则；零违规）                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **W1-D**（evaluation）                          | ✅ **决定：维持双份** | 无代码改动。依据：harness 源码头注释已记录"TI 商用基线保留本地副本"；两份 diff 仅 13 行近等价；5 个同名服务（ReportQualityGate/CritiqueRefine/ReportEvaluation/SectionSelfEval/SectionRemediation）双份均 live（TI 本地 import + harness 经 facade 供 agent-playground/report-artifact-assembler），**非死副本，不可删**。抽 L2 engine 无状态 core 给两份共用=待决策（需先 grep ai-app/writing/services/quality 排查误撞，建议否）。`QualityTraceComputeService(harness)` vs `ReportQualityTraceService(TI)` 是异名异实现，非冲突 |

### 剩余 XL 波次（H/A/F）—— 单 PR 原子、breaksArchMidway，各需专注落地

- **H-ingestion**（阻断决策）：迁入 platform(L1) 后残留 3 处 `platform→ai-app(explore)` 反向 import（config.module:23 / crawlers.module:17 / hackernews.service:5），`layer-boundaries.spec:211` 硬断言必 RED。**单 PR 不可能 green，波次前提自相矛盾**。三方案选一（推荐 **i**）：(i) 引入 DI 端口让 platform 只依赖抽象、explore 侧实现注入；(ii) 不迁 L1；(iii) spec 加 allowlist（下策）。另：补 5 处漏列 consumer rewrite（explore link-health/feed + 2 jest.mock）；删 2 个 phantom edit（topic-insights/research-project 实不 import IngestionConfigModule）。
- **A-credentials**（XL ~107 文件原子）：ai-engine/facade credential re-export 实为 **770-819 整段**（非 5 service）。推荐 **方案 A**：repoint 整段为 `@deprecated` 转发 `from platform/facade`，使 9 个间接消费方 + harness/facade:1374-1386 无需逐个改。补 34 个测试文件 import rewrite（tsc/jest 必查）。本波建议**只搬 credentials**，secrets/encryption/key-health 拆波记债。
- **F-teams**（XL ~30 文件原子）：**硬前提**——harness/facade 当前**不导出** MissionStateManager/MissionContextService/MissionInputService（grep 0），主 Agent 须先在 facade/index.ts 新增 3 export。目标目录 `harness/teams/collaboration/context/` **不存在**需先建。teams.module 是扁平模块不 import CollaborationModule。补 ~17 spec rewrite。`MissionContext/Input` 落点（engine vs harness）开工前二次确认依赖就近。

---

**维护者**：Claude Code · **版本**：2.0（W1 全合 main + W2-E/W1-I committed + D 定案；H/A/F runbook 见上）
**下次更新**：H/A/F 各自原子 PR 落地后回填
