# 2026-05-20 之后需求收口单：Mac mini 运行节点 / MacBook 开发节点

> 状态：`draft-for-approval`
> 版本：`2026-08-10`
> 需求窗口：严格新增范围为 `2026-05-21 00:00Z` 至 `2026-06-10 00:35:51Z`
> 基线范围：另列 2026-05-20 当日 2 条产品基线，避免丢失上下文
> 运行决策：Mac mini 只承担运行，开发、编译、评审和优化迁往 MacBook
> 后续生命周期决策：洞察研究、报告写作与分析的产品归属已迁移到 GenesisPod；Solar 仅保留数据供给和迁移兼容，见 [迁移说明](../migrations/insight-reporting-to-genesispod.md)

## 1. 结论

本需求单把 5 月 20 日之后积累的需求、修复单和架构单从“并行旧 Epic”收口为 8 条正式主线。历史证据保留，但旧 autopilot、solard、coordinator、recovery scanner 和 Claude 开发执行池不得在 Mac mini 恢复。

```text
┌──────────────────────────────┬────────┬──────────────────────────────────────────┐
│ 统计口径                     │ 数量   │ 结论                                     │
├──────────────────────────────┼────────┼──────────────────────────────────────────┤
│ 5/21 起标准 Intake           │ 62     │ 原始请求记录，不等于独立产品需求         │
│ 5/20 基线                    │ 2      │ 只作前置背景，不计入严格新增范围           │
│ 严格 5/20 后去重主题         │ 56     │ 本文逐条建立处置映射                     │
│ 生成 Epic 的 Intake          │ 53     │ 仍有父子状态漂移                         │
│ 收口后的正式需求主线         │ 8      │ 4 条 P0、3 条 P1、1 条 P2                │
│ 历史派发事件                 │ 17,232 │ 仅 408 个逻辑派发键，存在严重重复重派     │
│ 旧开发运行链                 │ 0      │ 已冻结；历史状态文件和证据未删除           │
└──────────────────────────────┴────────┴──────────────────────────────────────────┘
```

### 1.1 强制决策

1. Mac mini 是运行节点，不再承担 PM、Planner、Builder、Evaluator、GEPA、compile-eval 或开发浏览器工作。
2. MacBook 是唯一开发节点；所有 Git 修改、测试、构建、任务图编译和评审在 MacBook 完成。
3. MacBook 只向 Mac mini 发布带版本、校验和、健康检查和回滚点的制品。
4. 历史 Epic/Sprint/task graph/ledger/handoff/eval 只归档，不因旧 `active`、`reviewing` 投影自动复活。
5. GenesisPod 采用按需启动；其 AI 服务不得使用 ThunderOMLX、OMLX、端口 8002 或同名 endpoint。
6. ThunderOMLX 可作为独立、可替换的知识抽取实验组件，但不能成为 GenesisPod 或系统事实源的硬依赖。
7. AI Influence 不启用 premium ASR；字幕优先，失败时允许 `metadata-only`，不得伪造完整转录。
8. SQLite、Evidence Ledger 和 task graph 的事实写入必须单写者、可回放、可审计。
9. 大咖洞察、AI Influence/DeepDive 洞察及报告规划、写作、分析、编辑、评估和导出的产品归属迁往 GenesisPod；Solar 将这些产品能力标记为 `retired`。

## 2. 目标拓扑

```text
MacBook（唯一开发面）
  ├─ Git / IDE / 分支 / 测试 / 构建
  ├─ PM / Planner / Builder / Evaluator
  ├─ Requirement Compiler / APO / GEPA
  ├─ TUI / cmux / browser development
  └─ 版本化 release + manifest + checksum
                         │
                         ▼ 单向部署
Mac mini（运行面）
  ├─ GenesisPod（按需，AI 不接 ThunderOMLX）
  ├─ GitHub / HF / Social / YouTube 采集
  ├─ 基础物化、证据溯源、同步、QMD / Mirage、数据库
  ├─ 只读健康状态、告警、日志轮转
  └─ no-dispatch 永久门禁
```

### 2.1 Mac mini 允许清单

- GenesisPod frontend/backend/AI/infra 的按需控制脚本。
- QMD、Mirage、状态服务、配置服务和必要数据库。
- GitHub、HF、Social/X、YouTube 的生产采集与物化任务。
- 向 GenesisPod 的数据同步、只读状态、健康检查、日志轮转和必要告警。
- Tailscale/SSH 等运维回程链路。

### 2.2 Mac mini 禁止清单

- `com.solar.autopilot`
- `com.solar.solard`
- `com.solar.watchdog` 的开发派发模式
- `com.solar.harness.operator-health-watchdog`
- `com.solar.harness.operator-recovery-scanner`
- `graph_node_dispatcher.py dispatch-ready`
- `pm_dispatch.py`、开发用途 `runtime_bridge.py`
- `solar-harness`、`solar-harness-lab` 和长寿 Claude 开发 pane
- GEPA / optimize_anything / compile-eval 的在线优化循环
- Antigravity 或其他开发入口自动唤醒

## 3. 正式需求主线

## P0-01：Mac mini 运行节点与 MacBook 开发节点彻底分离

### 问题

Mac mini 同时承担生产运行与持续开发调度，导致后台派单、Claude pane 常驻、状态重写、内存尖峰和服务职责混淆。

### 功能要求

1. Mac mini 默认存在永久 `no-dispatch` 门禁。
2. 开发调度相关 launchd label 必须保持 `disabled + unloaded`。
3. 运行服务必须有显式 owner、启动方式、端口、健康端点和资源预算。
4. GenesisPod 默认停止；只有 `control.sh start` 才启动 frontend/backend，只有 `--with-ai` 才启动 AI sidecar。
5. GenesisPod AI endpoint policy 必须 fail-closed 拒绝：
   - hostname 含 `thunderomlx` 或 `omlx`；
   - 端口 `8002`；
   - 非 HTTP(S) 或非法 URL。
6. 发布制品必须包含：版本、Git SHA、构建时间、manifest、SHA-256、数据库迁移说明和回滚指令。
7. Mac mini 不得直接执行 `npm run dev`、开发 watcher、测试 watcher 或源码热重载服务器。

### 非目标

- 不删除历史代码、Sprint、日志或任务证据。
- 不在本需求中重构 GenesisPod 产品逻辑。
- 不强制生产采集器全部常驻；应按日历、队列或需求启动。

### 验收

- 连续 24 小时开发派发账本零增长。
- 五个开发 label 均为 `disabled + unloaded`，重启后不复活。
- 无 PM/Planner/Builder/Evaluator Claude pane，无 active development lease。
- GenesisPod 按需启动时 3000/3001/5050 通过真实 HTTP；停止后端口消失且数据卷保留。
- GenesisPod 进程对 8002/8003 无连接，代码和配置中的禁止策略测试通过。
- Mac mini 运行服务的 idle 内存、峰值内存和日志增长均有预算与告警。

### 回滚

只允许人工维护窗恢复某个明确服务；不得整体恢复旧开发调度链。任何临时恢复结束后必须重新启用 `no-dispatch` 并复核账本零增长。

## P0-02：历史开发任务冻结、归档和映射

### 问题

父 Epic、子 Sprint、缓存和派发账本之间存在状态漂移；`passed parent + active child`、`cancelled parent + passed child` 和随机 task ID 重派会把历史项目误判成新工作。

### 功能要求

1. 保留所有 Epic、Sprint、task graph、dispatch、handoff、eval、closure 和 ledger 原件。
2. 新增只读归档 manifest，字段至少包括：
   - `legacy_epic_id`
   - `source_intake`
   - `canonical_requirement_id`
   - `evidence_status`
   - `disposition`
   - `residual_risk`
   - `migration_owner`
3. `disposition` 只允许：`closed_verified`、`terminated_archived`、`superseded`、`migrate_macbook`、`runtime_keep`。
4. 不得用批量改写历史 `status.json` 的方式伪造一致性；状态修复必须由最终证据重建。
5. `cancelled`、`superseded`、`terminated_archived` 项不得进入 dispatcher、recovery 或 orphan reaper。
6. 旧任务迁入 MacBook 前必须重新确认需求仍有效、代码差异仍存在、验收仍适用。

### 验收

- 本文 56 个严格新增主题全部有唯一处置结论。
- 53 个 Intake Epic 与缓存里的额外/缺失 Epic 均有映射。
- 不存在没有 source intake 或没有最终处置的旧开发 Epic。
- 归档后重启调度器的 dry-run 不产生任何旧任务派发。
- 历史文件 checksum 可验证，归档操作不删除原始证据。

## P0-03：未来 MacBook 调度器的幂等、总闸门与单一权威

### 问题

PM 派发账本有 17,232 个事件，但只有 408 个逻辑派发键；其中 7,375 个 `failed_submit_exception`、5,871 个 `no_dispatchable_operator`。最高四个逻辑节点分别重复 3,193、2,735、2,389 和 989 次。

### 功能要求

1. 全局 maintenance/no-dispatch gate 必须在一个调度周期内阻止所有新提交。
2. 幂等键固定为：`sprint_id + node_id + role + graph_revision`；随机 task ID 不得绕过去重。
3. 同一幂等键只允许一个有效 dispatch 和一个有效 lease。
4. dispatcher、autopilot、coordinator、recovery scanner 只能有一个调度权威；其余只能提交建议或只读诊断。
5. 失败策略必须有界：指数退避、最大重试次数、熔断、人工审查队列。
6. 进程 PID 不能单独证明锁有效；锁需验证 hostname、process identity、start time 和 TTL。
7. recovery 不得把业务失败、取消任务或已 superseded 节点重新排队。
8. 所有派发、拒绝、熔断、人工恢复都写入同一可审计 ledger。

### 验收

- 同一逻辑节点并发/重复提交为 0。
- 调度器重启和崩溃恢复不产生额外 task ID。
- 连续 1,000 次幂等重放只产生 1 个有效 dispatch。
- 达到重试阈值后进入人工审查，不再自动 requeue。
- kill switch、熔断和恢复路径均有故障注入测试。

## P0-04：Evidence / Status / Closure 唯一事实链

### 问题

旧系统同时依赖 task graph 内联状态、sidecar、缓存、tmux 标题、handoff 和 ledger，造成父子终态冲突以及“输出文件存在即完成”的假阳性。

### 功能要求

唯一事实链为：

```text
RequestEnvelope
  -> RequirementIR
  -> ContractSet / Traceability
  -> task_graph.spec
  -> task_dag.state / events
  -> DispatchPackage / Lease
  -> Eval / Verification Evidence
  -> Closure
```

1. spec 只存拓扑与契约；state 只存运行态；closure 只存最终验收事实。
2. writer 不得自证完成；required gate 必须由独立 evaluator/verifier 输出。
3. parent passed 必须满足所有 required nodes、gates、tests 和 traceability。
4. closure 至少包含：evidence IDs、测试结果、变更文件、风险、回滚、验收覆盖率。
5. tmux pane 标题、stdout 和缓存只能是观察信号，不能成为状态权威。
6. Evidence Ledger 必须可按 run、attempt、logical dispatch key 和 artifact digest 回放。
7. 所有 SQLite 写入遵守单写者门禁；活跃 DB/WAL/SHM 句柄存在时保持只读。

### 验收

- 所有历史父子终态矛盾生成可解释差异报告。
- 任一关闭项可仅凭最终 artifacts 重建状态，不依赖运行中的 pane。
- 篡改单个缓存或标题不会改变 canonical closure。
- failed/cancelled/superseded 不会被错误投影为 active。

## P1-01：Solar Research Radar 三源统一

### 目标

将分散的 GitHub、HF、Social/X、YouTube 和 Deep Research 项目收口成统一研究雷达，而不是继续扩张为多个同义产品。

### 来源面

1. Paper Source：HF Paper Insight。
2. Code Source：GitHub Project Intelligence / Code Signal Plane。
3. Influence Source：Social/X/YouTube Signal Plane。

### Solar / GenesisPod 输出边界

- Solar 数据面：`EvidencePacket`、来源 URL、抓取时间、freshness、provenance、同步 manifest。
- GenesisPod 产品面：`ThesisBrief`、`CrossSourceResonance`、`DeepResearchSeed`、`ActionQueue`、Daily/Weekly Report 及交互式洞察产品。

### 功能要求

1. Mac mini 的 Solar 侧只运行采集、去重、基础物化、证据溯源和向 GenesisPod 的同步；不再拥有洞察报告产品或报告写作分析调度。
2. schema、排序、归因、UI、模型策略和算法开发迁往 MacBook。
3. Provider-neutral；ThunderOMLX 只能作为可替换 extractor，缺失时必须明确降级。
4. YouTube 字幕优先；禁止 premium ASR；字幕不可得时输出 `metadata-only`。
5. GitHub 三套相近需求合并为一个 Code Signal Plane。
6. X/Social 和五条 AI Influence 算子合并为一个 Influence Source。
7. Deep Research 只按需触发，浏览器 worker 不常驻。

### 验收

- 三源共享 evidence schema、去重键、freshness 和 attribution contract。
- 日/周报可追溯到原始 URL、抓取时间和 evidence ID。
- 模型或 extractor 不可用时标记 `warn/error`，不得生成“看似成功”的替代分析。
- Mac mini 上不出现研究产品开发任务或长寿浏览器开发会话。

## P1-02：Context Access Plane 收口

### 功能要求

1. Mirage 是统一 context access layer。
2. QMD 提供确定性检索和索引。
3. CocoIndex 提供增量 lineage、变更传播和可追溯关系。
4. raw、accepted、semantic、evidence、quarantine 分层存储。
5. Knowledge Ingest Dispatcher 管理状态机、validator、repair、quarantine 和 circuit breaker。
6. Understand-Anything 降为历史实验或可选 adapter，不再是独立生产依赖。
7. ThunderOMLX 只允许作为 L2 可替换抽取器；SQLite registry 和原始 artifact 才是事实源。

### 验收

- 任一知识条目可追溯到 source、ingest run、transform、validator 和 index digest。
- 关闭 ThunderOMLX 不破坏 raw/QMD 确定性检索。
- quarantine 数据不会进入生产语义索引。
- 单写者、批次水位和断点恢复有真实故障测试。

## P1-03：Requirement Compiler + Capsule / Operator Runtime

### 目标

把 5 月 31 日大量相互重叠的 Actor、Lease、APO、IR、Capsule、OperatorScore、Eval Factory 和 Requirement Compiler 单合并成一条工程主线。

### 功能要求

1. 支持 Intent / Spec / Plan / Capsule / Effect / Physical / Runtime / Evidence IR。
2. Capsule 是带 capability contract、effect、proof obligation、risk/cost 的版本化能力资产。
3. tmux/TUI 只作为 physical host，不作为 RPC、任务队列或状态权威。
4. Operator Runtime 提供 mailbox、ACK、lease、heartbeat、quota、respawn、hygiene 和 evidence。
5. APO 对 lease/quota/cost/capability/risk 做可解释选择。
6. OperatorScore 使用本地任务证据，并输出 factors、penalties、selected/rejected reasons。
7. Eval/Verifier Factory 从 Spec/Effect/Evidence IR 和历史失败生成 gate 与 scorer，并有 registry、版本和 holdout 治理。
8. Antigravity 只允许 exploration/fan-out，不得承担最终裁决。
9. Terminal-Bench 2.0 作为 benchmark adapter，仅在 MacBook smoke/CI 环境运行。

### 验收

- 端到端 `request -> compile -> dispatch -> eval -> closure` 有可重放 golden path。
- 不依赖 `tmux send-keys` 才能完成核心协议。
- capability token 在 HTTP/tool/effect 出口做 fail-closed 权限检查。
- 所有 actor selection 可解释且引用本地 evidence。
- 旧同义 Epic 只映射到本主线，不再并行派发。

## P2-01：离线 Optimizer / GEPA Evolution

### 功能要求

1. 只在 MacBook 离线运行，不在 Mac mini 或生产调度器运行。
2. 只优化可版本化 artifact：profile、policy、capsule、routing、rewrite、cost model、binding policy。
3. 数据严格分为 trainset、held-out valset、hidden holdout 和 hard cases。
4. 使用 Pareto frontier 管理质量、成本、延迟、风险，不用单分数替代多目标治理。
5. 候选必须经 canary、promotion 和 rollback；不得直接修改 active RequirementIR、task graph、Mini 配置或生产源码。
6. CORAL-style runtime 只负责开放式搜索与 attempt lineage；Solar Optimizer 保持编译、治理和发布权威。

### 验收

- valset/holdout 不参与 mutation。
- 相同输入、profile digest 和 seed 可重放结果。
- candidate 未通过 verifier/holdout 时不能 promotion。
- production 只消费签名、版本化、可回滚的已发布 artifact。

## 4. 历史需求处置矩阵

状态是冻结前的 canonical 投影快照，只用于说明历史，不表示仍在执行。所有 `active/reviewing` 项当前都已终止运行，后续需在 MacBook 重新评审后才能恢复。

### 4.1 5 月 20 日基线（不计入严格新增 56 项）

| ID | 状态 | 原始需求 | 处置 |
|---|---|---|---|
| [B-01](/Users/lisihao/Knowledge/_raw/solar-harness/intake/intake-20260520T001341Z.md) | N/A | Code-as-Harness Runtime | 作为 P1-03 的架构基线，不恢复旧 Epic |
| [B-02](/Users/lisihao/Knowledge/_raw/solar-harness/intake/intake-20260520T201839Z.md) | N/A | Multi-Task Screen Product UI Redesign | 开发 UI 迁 MacBook；Mini 只保留只读状态面 |

### 4.2 知识、研究与情报（H-01—H-15）

| ID | 日期 | 快照 | 原始需求 | 处置 |
|---|---:|---|---|---|
| [H-01](/Users/lisihao/Knowledge/_raw/solar-harness/intake/intake-20260521T002131Z.md) | 05-21 | N/A | Terminal-Bench 2.0 Benchmark Submodule | 并入 P1-03；只在 MacBook/CI 运行 |
| [H-02](/Users/lisihao/Knowledge/_raw/solar-harness/intake/intake-20260522T021955Z.md) | 05-22 | passed | ThunderOMLX KVTC 论文对齐、真实 KV 重建门禁 | 归档；不得成为 Genesis AI 依赖 |
| [H-03](/Users/lisihao/Knowledge/_raw/solar-harness/intake/intake-20260524T145859Z.md) | 05-24 | N/A | Knowledge Ingest Dispatcher 统一控制面 | 并入 P1-02，重新核验完成证据 |
| [H-04](/Users/lisihao/Knowledge/_raw/solar-harness/intake/intake-20260524T172015Z.md) | 05-24 | passed | Knowledge-wide ThunderOMLX Semantic Layer | 并入 P1-02；改为 provider-neutral extractor |
| [H-05](/Users/lisihao/Knowledge/_raw/solar-harness/intake/intake-20260524T175128Z.md) | 05-24 | passed | GitHub Project Intelligence System | 并入 P1-01 Code Source，关闭旧 Epic |
| [H-06](/Users/lisihao/Knowledge/_raw/solar-harness/intake/intake-20260526T014418Z.md) | 05-26 | passed | X 大咖 Social Browser Backend | Mini 保留采集；开发并入 P1-01 |
| [H-07](/Users/lisihao/Knowledge/_raw/solar-harness/intake/intake-20260526T185205Z.md) | 05-26 | active | Mac mini 集成 Understand-Anything | 1 passed/4 cancelled；终止归档，不恢复 |
| [H-08](/Users/lisihao/Knowledge/_raw/solar-harness/intake/intake-20260527T023904Z.md) | 05-27 | passed | YouTube Transcript 与 ASR 分层重构 | 并入 P1-01；字幕优先、无 premium ASR |
| [H-09](/Users/lisihao/Knowledge/_raw/solar-harness/intake/intake-20260527T170916Z.md) | 05-27 | passed | TUI Pane Recover / Clean Pane 生命周期 | 开发工作台迁 MacBook；关闭旧 Epic |
| [H-10](/Users/lisihao/Knowledge/_raw/solar-harness/intake/intake-20260528T004705Z.md) | 05-28 | passed | HF Paper-to-Project 研究信号编译器 | Mini 保留采集；开发并入 P1-01 |
| [H-11](/Users/lisihao/Knowledge/_raw/solar-harness/intake/intake-20260529T023148Z.md) | 05-29 | passed | YouTube 报告流默认流程固化 | 并入 P1-01，关闭旧 Epic |
| [H-12](/Users/lisihao/Knowledge/_raw/solar-harness/intake/intake-20260529T183759Z.md) | 05-29 | passed | Gemini Deep Research 浏览器全流程 | 仅 MacBook 按需研究；worker 不常驻 |
| [H-13](/Users/lisihao/Knowledge/_raw/solar-harness/intake/intake-20260530T165319Z.md) | 05-30 | active | GitHub 开源社区趋势情报系统 | 5/5 子项 passed，属父状态漂移；并入 P1-01 |
| [H-14](/Users/lisihao/Knowledge/_raw/solar-harness/intake/intake-20260530T212957Z.md) | 05-30 | passed | 5 条 AI Influence 算子默认接入 | 并入 P1-01 Influence Source |
| [H-15](/Users/lisihao/Knowledge/_raw/solar-harness/intake/intake-20260530T224715Z.md) | 05-30 | N/A | 本周大咖全量采集、外链图片与简报 | 运行请求，不是长期开发 Epic；保留结果证据 |

### 4.3 Actor、调度、证据与权限（H-16—H-35）

| ID | 快照 | 原始需求 | 关键遗留 | 处置 |
|---|---|---|---|---|
| [H-16](/Users/lisihao/Knowledge/_raw/solar-harness/intake/intake-20260531T003742Z.md) | passed | ActorHost taxonomy / actor-first runtime | 终态仍有投影冲突 | 并入 P1-03 |
| [H-17](/Users/lisihao/Knowledge/_raw/solar-harness/intake/intake-20260531T003858Z.md) | passed | 去除 tmux send-keys，收口 operatord mailbox | 运行中仍依赖旧 pane 链 | 并入 P1-03，MacBook 重验 |
| [H-18](/Users/lisihao/Knowledge/_raw/solar-harness/intake/intake-20260531T004020Z.md) | passed | pane lease 升级 actor lease | 父 passed 与子节点冲突 | 并入 P0-03/P1-03 |
| [H-19](/Users/lisihao/Knowledge/_raw/solar-harness/intake/intake-20260531T004414Z.md) | active | capability/risk/cost runtime 强约束 | S04 active、S05 queued | 迁 P1-03 |
| [H-20](/Users/lisihao/Knowledge/_raw/solar-harness/intake/intake-20260531T004506Z.md) | active | APO v2 Lease/Quota/Cost-Aware Optimizer | S01 failed_review、阶段顺序失真 | 迁 P1-03，先重验 |
| [H-21](/Users/lisihao/Knowledge/_raw/solar-harness/intake/intake-20260531T004612Z.md) | active | 逻辑算子成为 DAG 第一公民 | S01 active、后续 queued | 迁 P1-03 |
| [H-22](/Users/lisihao/Knowledge/_raw/solar-harness/intake/intake-20260531T004801Z.md) | active | OperatorScore runtime 主评分 | S03 reviewing、S05 drafting | 迁 P1-03 |
| [H-23](/Users/lisihao/Knowledge/_raw/solar-harness/intake/intake-20260531T004948Z.md) | passed | 验证成为 DAG 强制结构 | 需确认真实 closure | 并入 P0-04 |
| [H-24](/Users/lisihao/Knowledge/_raw/solar-harness/intake/intake-20260531T005017Z.md) | reviewing | Evidence Ledger 完整 runs 审计链 | S05 active | P0-04 优先补齐 |
| [H-25](/Users/lisihao/Knowledge/_raw/solar-harness/intake/intake-20260531T005248Z.md) | reviewing | Context Store 主权 | S03 active、S05 queued | 并入 P1-02/P0-04 |
| [H-26](/Users/lisihao/Knowledge/_raw/solar-harness/intake/intake-20260531T005433Z.md) | reviewing | capability token runtime 权限边界 | 5/5 passed 但父 reviewing | 关闭漂移；能力并入 P1-03 |
| [H-27](/Users/lisihao/Knowledge/_raw/solar-harness/intake/intake-20260531T005626Z.md) | active | Antigravity 仅 exploration/fan-out | S03 active | 规则并入 P1-03；旧入口不在 Mini 恢复 |
| [H-28](/Users/lisihao/Knowledge/_raw/solar-harness/intake/intake-20260531T005841Z.md) | reviewing | failure fingerprint operator 画像 | S05 active | 并入 P0-03 |
| [H-29](/Users/lisihao/Knowledge/_raw/solar-harness/intake/intake-20260531T010345Z.md) | active | 推荐架构收口默认执行脊柱 | S05 active | 并入 P1-03，不单独恢复 |
| [H-30](/Users/lisihao/Knowledge/_raw/solar-harness/intake/intake-20260531T010744Z.md) | reviewing | APO 动态能力供应链 | S05 active | 并入 P1-03 |
| [H-31](/Users/lisihao/Knowledge/_raw/solar-harness/intake/intake-20260531T011120Z.md) | active | Capsule-native 能力资产系统 | S02 active、后续 queued | 迁 P1-03 |
| [H-32](/Users/lisihao/Knowledge/_raw/solar-harness/intake/intake-20260531T011407Z.md) | reviewing | Logical/Capsule/Physical Operator 编译链 | S05 active | 并入 P1-03 |
| [H-33](/Users/lisihao/Knowledge/_raw/solar-harness/intake/intake-20260531T011751Z.md) | reviewing | Capsule-native Agent OS runtime | S05 active | 并入 P1-03 |
| [H-34](/Users/lisihao/Knowledge/_raw/solar-harness/intake/intake-20260531T014826Z.md) | reviewing | Antigravity 2.0 requirement ingress | S05 active | MacBook 可选实验；Mini 禁止自动入口 |
| [H-35](/Users/lisihao/Knowledge/_raw/solar-harness/intake/intake-20260531T020539Z.md) | passed | status #lab 误报 idle | 历史 UI 修复 | 关闭；开发 UI 迁 MacBook |

### 4.4 Compiler、Optimizer、Context 与总体架构（H-36—H-52）

| ID | 快照 | 原始需求 | 关键遗留 | 处置 |
|---|---|---|---|---|
| [H-36](/Users/lisihao/Knowledge/_raw/solar-harness/intake/intake-20260531T022137Z.md) | active | GEPA Stage 1 离线元优化引擎 | S03/S05 active | 并入 P2-01 |
| [H-37](/Users/lisihao/Knowledge/_raw/solar-harness/intake/intake-20260531T025209Z.md) | active | GEPA 消费 Evidence Ledger 外循环 | S02 active、后续 queued | 并入 P2-01，先等 P0-04 |
| [H-38](/Users/lisihao/Knowledge/_raw/solar-harness/intake/intake-20260531T031656Z.md) | active | Terminal-first Capsule-native Evolution Optimizer | S04 active、S05 queued | 拆入 P1-03/P2-01 |
| [H-39](/Users/lisihao/Knowledge/_raw/solar-harness/intake/intake-20260531T031909Z.md) | active | Solar Agent IR Compiler + Capsule Runtime | S03 active、S05 drafting | 并入 P1-03 |
| [H-40](/Users/lisihao/Knowledge/_raw/solar-harness/intake/intake-20260531T032121Z.md) | reviewing | TUI/tmux 降级 physical host / Operator Runtime | S04 active、S05 drafting | 并入 P1-03 |
| [H-41](/Users/lisihao/Knowledge/_raw/solar-harness/intake/intake-20260531T032351Z.md) | reviewing | Solar Optimizer 进化架构 | S03 approved、S05 drafting | 拆入 P1-03/P2-01 |
| [H-42](/Users/lisihao/Knowledge/_raw/solar-harness/intake/intake-20260531T032558Z.md) | active | Eval/Verifier Factory | S02 active、后续 queued | 并入 P1-03/P0-04 |
| [H-43](/Users/lisihao/Knowledge/_raw/solar-harness/intake/intake-20260531T032836Z.md) | active | Solar Capsule Evolution Optimizer | S03 active、S05 queued | 作为 P1-03/P2-01 总体参考 |
| [H-44](/Users/lisihao/Knowledge/_raw/solar-harness/intake/intake-20260531T033235Z.md) | active | Deep Understanding / CocoIndex lineage | S02 active、后续 queued | 并入 P1-02 |
| [H-45](/Users/lisihao/Knowledge/_raw/solar-harness/intake/intake-20260531T033513Z.md) | passed | Mirage Context Access Plane | 父 passed 仍留 active 子项 | 关闭漂移；能力并入 P1-02 |
| [H-46](/Users/lisihao/Knowledge/_raw/solar-harness/intake/intake-20260531T034112Z.md) | reviewing | PM/Requirement Compiler 控制面 | S02 active、后续 queued | 并入 P1-03 |
| [H-47](/Users/lisihao/Knowledge/_raw/solar-harness/intake/intake-20260531T034654Z.md) | active | Self-Optimizing Requirement Compiler | 5/5 passed 但父 active | 关闭漂移；优化部分并入 P2-01 |
| [H-48](/Users/lisihao/Knowledge/_raw/solar-harness/intake/intake-20260531T035051Z.md) | active | 自优化需求编译与执行 OS | S04 active、S05 queued | 拆入 P1-03/P2-01 |
| [H-49](/Users/lisihao/Knowledge/_raw/solar-harness/intake/intake-20260531T041247Z.md) | passed | task_graph spec/state/closure 三分面 | 需真实状态重建验证 | 并入 P0-04 |
| [H-50](/Users/lisihao/Knowledge/_raw/solar-harness/intake/intake-20260531T123900Z.md) | active | autopilot 去重 / operator-pool compatibility | S04 active、S05 queued | 旧单终止；要求并入 P0-03 |
| [H-51](/Users/lisihao/Knowledge/_raw/solar-harness/intake/intake-20260531T132236Z.md) | reviewing | GEPA Requirement Compiler 外循环二阶段 | 重复发单已合并 | 并入 P2-01 |
| [H-52](/Users/lisihao/Knowledge/_raw/solar-harness/intake/intake-20260531T133251Z.md) | passed | cmux 多标签四分屏工作台 | 开发专用 | 关闭旧 Epic；仅 MacBook 使用 |

### 4.5 报告、DeepDive 与稳定性（H-53—H-56）

| ID | 日期 | 快照 | 原始需求 | 处置 |
|---|---:|---|---|---|
| [H-53](/Users/lisihao/Knowledge/_raw/solar-harness/intake/intake-20260531T195110Z.md) | 05-31 | cancelled | YouTube Report IR / Deep Writer / Verifier | 以父 cancelled 为准；产品能力迁往 GenesisPod，Solar 归档废除 |
| [H-54](/Users/lisihao/Knowledge/_raw/solar-harness/intake/intake-20260605T010906Z.md) | 06-05 | passed | DeepDive Insight Runtime v2 / CAIS | 历史成果保留；产品能力迁往 GenesisPod，Solar 归档废除 |
| [H-55](/Users/lisihao/Knowledge/_raw/solar-harness/intake/intake-20260605T011517Z.md) | 06-05 | passed | Operator Health Watchdog | 旧开发恢复器不在 Mini 恢复；规则并入 P0-03 |
| [H-56](/Users/lisihao/Knowledge/_raw/solar-harness/intake/intake-20260610T003551Z.md) | 06-10 | N/A | 定时任务复活 + 告警接线 + 派发 requeue | 已 superseded；终止归档，反重派要求并入 P0-03 |

## 5. 状态漂移清单

以下项目不得因旧缓存显示 `active/reviewing` 而恢复：

- GitHub 趋势系统：5/5 子项 passed，父仍 active。
- Self-Optimizing Requirement Compiler：5/5 子项 passed，父仍 active。
- Capability Token：5/5 子项 passed，父仍 reviewing。
- Understand-Anything：父 active，实际 1 passed、4 cancelled。
- Mirage Context Access Plane：父 passed，仍留 active 子项。
- Actor Lease：父 passed，仍留活动尾项。
- YouTube Report IR：父 cancelled，子项却显示 passed。
- GEPA Requirement Compiler 二阶段：同内容重复创建。
- Harness 稳定性三连修：源 Epic 已 superseded，但旧派发仍曾持续重投。

任何状态修复必须从 PRD、contract、task graph spec/state、eval、closure 和最终 artifact 重建；不得从 dispatch 次数或 tmux pane 标题推断完成度。

## 6. 实施顺序

```text
Phase 0  维持 Mac mini no-dispatch + 运行白名单
   ↓
Phase 1  生成历史 archive manifest 和状态漂移报告
   ↓
Phase 2  在 MacBook 修复幂等调度与 Evidence/Closure 事实链
   ↓
Phase 3  迁移 Requirement Compiler + Capsule/Operator Runtime
   ↓
Phase 4  收口 Research Radar 与 Context Access Plane
   ↓
Phase 5  最后启用 MacBook-only 离线 Optimizer
```

前置门禁：P0-01 至 P0-04 未全部通过前，不启动 P2-01，不恢复任何旧 Epic 自动派发。

## 7. 非功能要求

### 安全

- 凭据不得出现在 plist、shell profile、报告、日志或仓库。
- 远程回程链路变更前必须有 SSH/Tailscale/Screen Sharing 回退。
- 外部端口默认绑定 loopback；需要 MacBook 访问时通过经认证入口显式开放。
- Genesis AI endpoint policy 采用 fail-closed。

### 资源

- Mac mini 稳态 unused memory 目标 `>= 12 GiB`，告警线 `< 8 GiB`。
- 重任务全局并发最多 1；轻任务最多 2。
- OMLX/模型任务启动前必须检查 headroom，不与构建、雷达重物化并发。
- 日志必须轮转；单文件上限、保留期和压缩策略需显式配置。

### 可观测性

- 每个运行服务暴露 owner、PID、端口、健康、最近成功、最近失败、下次调度。
- launchd `loaded/running` 不能代替 HTTP、端口、DB 和最终 artifact 验证。
- 报告明确区分 `ok | warn | error | pending`。

## 8. 证据与口径

主要证据：

- [Intake 原始记录](/Users/lisihao/Knowledge/_raw/solar-harness/intake)
- [Sprint / Epic / sidecar](/Users/lisihao/.solar/harness/sprints)
- [PM 派发账本](/Users/lisihao/.solar/harness/run/dispatch-ledger/pm-dispatch.jsonl)
- [进度缓存](/Users/lisihao/.agents/state/development-progress-report/state.json)
- [APO v2 需求](/Users/lisihao/Solar/harness/docs/requirements/apo-v2-lease-quota-cost-optimizer.md)
- [DeepDive v2 需求](/Users/lisihao/Solar/harness/docs/requirements/deepdive-insight-runtime-v2-cais-agent-insight.md)
- [Operator Watchdog 需求](/Users/lisihao/Solar/harness/docs/requirements/operator-health-watchdog-cooldown-recovery.md)

口径限制：

- `passed/active/reviewing/cancelled` 是冻结前状态投影，不是当前运行状态。
- dispatch ledger 的随机 task ID 不计为新需求。
- 纯 `list/status/dump/刷新/pane 查看/执行既有 dispatch 文件` 请求不计入需求主题。
- 两条 5 月 20 日产品需求仅作基线；严格新增清单从 5 月 21 日开始。
- Knowledge-wide contract 与正式 intake 合并；GEPA 二阶段重复发单合并。

## 9. Definition of Done

本需求单完成需要同时满足：

1. Mac mini 24 小时无开发派发增长。
2. 历史 56 个主题全部映射到 8 条主线或明确归档。
3. P0-01 至 P0-04 的自动化验收全部通过。
4. MacBook 可完成构建、测试、制品发布和回滚演练。
5. Mac mini 仅从制品部署，生产健康由真实端口/HTTP/DB/artifact 验证。
6. GenesisPod 无 ThunderOMLX/OMLX/8002 运行依赖。
7. 没有删除、伪造或批量覆盖历史证据。
8. 所有剩余风险、未验证项和人工审批点均显式列出。
9. Solar 的洞察报告产品能力均标记为 `retired`，新的报告写作、分析、编辑、评估和导出只在 GenesisPod 实现。
