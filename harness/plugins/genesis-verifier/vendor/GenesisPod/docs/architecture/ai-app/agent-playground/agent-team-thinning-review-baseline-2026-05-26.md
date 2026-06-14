# Agent Team Thinning v2 — 系统性多轮审视基线

**Date**: 2026-05-26
**Status**: Baseline v1（首次完整跑通 5 轮审视）
**Subject**: [agent-team-thinning-plan-2026-05-26.md](./agent-team-thinning-plan-2026-05-26.md) v2.0
**Purpose**: 把 plan 从"静态 snapshot"提升到"动态可演进决策基线"

---

## 0. 方法论

### 0.1 为什么多轮审视

单次 review 容易陷入两个反模式：
- **清单驱动**：把"主干有什么 / 文档说什么"对一遍 → 静态对账，发现不了未来风险
- **直觉驱动**：凭经验挑几个担忧 → 覆盖不全，每个评审者看到的 blind spot 不同

多轮审视用**独立透镜**分别扫，每轮只回答一个问题，互不串台，最后汇总。

### 0.2 5 轮设计

| 轮次 | 透镜 | 核心问题 | 输出 |
|---|---|---|---|
| **R1** | 主干对齐（Static） | plan 的每个事实声明在 main 上验证得过吗？ | 主干现实校正项（已在 plan 落地） |
| **R2** | 三大目标覆盖 | plan 是否真的服务"逻辑重后台 / 通用沉淀 / 目录极致收口"3 目标？哪里有"假装服务"? | 目标 vs 章节追溯矩阵 + 漏项 |
| **R3** | 动态演化（Future） | 12-24 个月后这个 framework 会被什么力量推翻？plan 里哪些决策会先死？ | 演化压力清单 + 可逆性评级 |
| **R4** | 可执行性 | 每个 Wave 能否切出真实可 review 的 PR？工具/数据/spec 框架到位吗？ | PR 级阻塞清单 + 工具链补丁 |
| **R5** | 风险与失败模式 | 什么情况下 plan 整体失败？什么情况下局部失败可恢复？应急路径在哪？ | 失败模式 catalog + 应急 runbook 索引 |

### 0.3 输出形态

每轮：
- **Criterion**：透过这个透镜，pass 的客观标准
- **Method**：用了什么手段（read main / trace section / 反事实思考）
- **Findings**：编号 finding（结构化）
- **Plan 增量建议**：对应 plan 哪节加什么
- **Outstanding**：这轮没解决、留给下一轮或用户决策的事

末尾 **§6 汇总** 列所有 plan 增量与用户决策项。

---

## R1. 主干对齐（Static）✅ 已闭环

### Criterion
plan 中每个事实性声明（"main 有 X / X 已完成 / X 在 Y 路径"）必须能用 `ls / grep / find` 在 main 验证。否则该声明视为"未来工作"，不能挂"✅ Done"。

### Method
- 扫 `backend/src/modules/ai-app/agent-playground/` 117 文件 → 实测 116，对齐
- 扫 `backend/src/modules/ai-harness/teams/business-team/` 子目录 → 实测 11 项，v1 plan 写 12 错
- 扫 `docs/architecture/decisions/` → 不存在，ADR 008/009 全部 vapor
- 扫 `@blueprint` tag → 0 个，"161 文件已完成"假
- grep `BusinessTeam.*Framework` → main 已有 20+ framework class，命名校验通过

### Findings

| # | 静态偏差 | 校正 |
|---|---|---|
| F1.1 | "W1 ✅ Done"（ADR 008/009 / BLUEPRINT.md / standard 23 §8 / @blueprint tags / CLI scaffold） | 全部反转为 W0 待补，明确"在远端分支 claude/playground-agent-team-minimal-44cWr" |
| F1.2 | "12 现有子目录 → 16" | 校正为 "11 → 15"，lifecycle/ 已存在不是新增 |
| F1.3 | "harness 现 3,454 LOC" | 校正为 main 实测 5,584 LOC（46 非测试文件） |
| F1.4 | "playground 117 文件 / 27,139 LOC" | 校正为 116 / 26,746 |
| F1.5 | "扩展现有 framework"措辞模糊 | 校正：三 app 已 extend framework，本节工作是"接管 app 剩余通用骨架"（§4.3 A2） |
| F1.6 | "PlaygroundDomainView 待评审" | 字段表已具体化（§5.2 A3，50+ 字段标 provenance） |

### Plan 增量（已落地）
- §0 关联文档分"main 现存 / 不在 main 待补"两块
- §W0 反转所有 ✅ Done
- §3.5 Prisma 字段归属表（A4 决策）
- §3.4 三 app 复用范围（A1 决策）
- §4.1 / §4.3 子目录与 framework 命名校正
- §4.4 harness LOC 基线更新

### Outstanding
- ❎ W0 处置仍待用户拍板：merge 远端分支 / 重做 / 跳过

---

## R2. 三大目标覆盖

### Criterion
plan 的每个章节必须可追溯到 1-3 个用户目标。如果存在"为了完整性写但不服务 3 目标"的章节 = 冗余。如果存在"声称服务但实际没动手"的目标 = 假装服务。

### Method
建立目标 → 章节追溯矩阵（goal × section）。每格标 STRONG / WEAK / ABSENT。

### 追溯矩阵

| Plan 章节 | G1 后端权威 | G2 通用沉淀 | G3 目录收口 |
|---|---|---|---|
| §1 三大目标声明 | STRONG | STRONG | STRONG |
| §2 通用 vs 专用判断 | — | **STRONG** | WEAK |
| §3.1 顶层 4 项结构 | — | WEAK | **STRONG** |
| §3.2 文件数估算 | — | — | **STRONG** |
| §3.3 LOC 目标 | — | — | **STRONG** |
| §3.4 chat/dag/export 三 app 复用 | — | **STRONG** | — |
| §3.5 Prisma 字段归属 | WEAK | **STRONG** | — |
| §4.1 harness 11→15 白名单 | — | **STRONG** | — |
| §4.2 4 新子目录设计 | WEAK | **STRONG** | — |
| §4.3 framework 接管 | — | **STRONG** | WEAK |
| §4.4 harness LOC | — | **STRONG** | — |
| §5.1 前端顶层结构 | **STRONG** | — | **STRONG** |
| §5.2 view-state contract 字段 | **STRONG** | WEAK | — |
| §5.4 canonical 反向抽 | **STRONG** | **STRONG** | WEAK |
| §6 三 app 瘦身效益 | — | **STRONG** | **STRONG** |
| §7 W1-W7 计划 | STRONG (W2/W4/W5) | STRONG (W3/W4/W5) | STRONG (W6) |
| §8 兼容性约束 | **STRONG** | WEAK | — |
| §9 看护机制 | WEAK | **STRONG** | **STRONG** |

### Findings

**F2.1 — G1 后端权威覆盖偏窄**

G1 几乎只通过"view-state contract"一条路径表达。**漏项**：
- 没明确写"前端禁区清单"——前端**绝对不能做**什么的反向定义
- mission cancel / abort / pause（不是 rerun，是 user-triggered 终止）的真相归属未写
- 长内容输入处理（playground 的 `inputBackground` / `inputEntities`）的语义归属：是前端做格式化展示，还是后端归一化标准 shape？

**建议 plan 增量** §5.3：「前端禁区清单」
- 5 类前端能力红线：mission/stage/agent 真相归约、artifact 兼容/synthesize、todo state 推导、rerunability 判断、event terminal re-fetch 调度
- ESLint 自动锁前端文件名（已有，但要扩文件名 pattern）
- 业务可视化和 UX 优化（formatter / friendly-error / locale）显式列在"允许做"

**F2.2 — G2 通用沉淀在 engine 层缺失**

G2 全部聚焦"harness 接管"。**漏项**：
- 没考虑下沉到 **engine 层**的工件（prompt template / skill registry adapter / model routing 等）
- 例如 playground 的 leader-chat-prompt.ts / writer-section-prompt 等 prompt 模板，本质是 prompt 资产，可能下沉到 engine/skills

**建议 plan 增量** §4.5：「engine 层下沉清单」
- 列出 app 内有哪些当前留在 app 但本质属于 engine 层的资产
- 大概率包括：prompt 模板模式 / model 选择策略 / RAG retrieval 模式
- 设软门槛：app 内不直接 inject `AiChatService`/`EmbeddingService`，必须通过 engine facade（已有但要核查穿透）

**F2.3 — G3 目录极致收口缺迁移中间态**

G3 给了起点（116 文件）和终点（≤50 文件），**漏项**：
- 没写"迁移期间的 disambiguation 规则"——例如 W5 把 mission/chat/ 上提 harness 时，app 内 `chat/` 还在但 harness 新 `chat/` 也建好，import 走哪？
- 没给"目录态势 checkpoint"——每个 Wave 结束时 app 应处于什么目录状态，避免迁移期目录混乱

**建议 plan 增量** §3.6：「Wave 间目录中间态」
- 每个 Wave 结束时 app 顶层 + mission/ 子目录应有的状态
- 迁移期 disambiguation 规则（preferred import = harness 新位置，app 旧位置 deprecate 但可 alias）

**F2.4 — 各章节 G1/G2/G3 标 STRONG 但实际深度不够**

例如 §5.4 canonical 反向抽 G1 STRONG，但只列 13 个 canonical 组件，没说**抽取算法**——同一个组件在 playground 和未来 social/radar 长得不一样时，怎么定义 canonical？参数化？slot？variants？

**建议 plan 增量** §5.4 补 "canonical 抽取的判定 + 适配策略"
- 抽取标准（同 §2 通用 vs 专用，但应用到 UI 层）
- variant 模式（强 type 参数 / 显式 slot 注入）
- props API 跨 team 演化规则（破坏性改动 = 3 app 同时更新）

### Outstanding
- F2.1 / F2.2 / F2.3 三项需要 plan 增加新章节，等用户确认是否落地
- F2.4 在 §5.4 局部加强，等用户确认深度

---

## R3. 动态演化（Future）

### Criterion
12-24 个月后这个 framework 不被现实推翻。每个 plan 决策必须能回答："什么场景下这个决策需要重做？预期成本是?"

### Method
反事实思考：列举 6 类可预见的演化压力，把 plan 决策放在压力下检验是否会先死。

### 演化压力清单

| 压力源 | 时间窗口 | 影响 |
|---|---|---|
| P1: 第 4-10 个 team app 接入 framework | 6-18 月 | hook 签名 / 子目录白名单 / 三 app 同步原则全部受压 |
| P2: AI 模型代际更新（Claude 5/GPT-5） | 4-9 月 | context window 跃迁 → chunking / compaction / token-counting 类 framework 部分作废 |
| P3: Mission 数据规模增长（事件 10K → 100K+） | 6-12 月 | view-state aggregate 性能 / DB load / cache 策略 |
| P4: Mission 编排形态演化（线性 14 stages → DAG / 嵌套 / 条件） | 12-24 月 | stage executor / rerun cascade 模型 |
| P5: 用户协作模式演化（单用户 → 多用户 / pause-edit-resume） | 12-18 月 | lifecycle 事件类型 / abort 语义 / ownership scope |
| P6: 合规与可观测性硬要求（GDPR / SOC2 / 审计追溯） | 12-24 月 | 数据保留 / 审计日志 / 删除保证 → mission lifecycle 接口扩展 |

### Findings

**F3.1 — P1（更多 team app）：hook 签名固化是最大风险**

plan §2.2 锁 `hook ≤ 5 / class`，standard 23 §6 锁"不破坏向后兼容"。两者叠加 = 第 4 app 接入若需要现 framework 不支持的形态，**没有路径**：加 hook 越限，改 signature 违反 §6。

**建议**：framework hook 设计阶段标注 **变更频率预期**：
- HIGH（预期未来加 sub-hook）：用 optional sub-hook、default impl、版本化签名
- MID：保留 generic param 扩展空间
- LOW：可以紧锁

具体到现 plan §4.2 设计：
- `expandNodes(missionId)` → **HIGH**（未来 DAG / 嵌套 / 条件分支节点类型会爆炸）
- `interpretDecision(text)` → **MID**（leader 决策类型可能演化）
- `getMissionRowPatch(domainState)` → **LOW**（Prisma row 字段稳定）
- `loadArtifact(missionId)` → **MID**（多 artifact 同 mission 模式）

**F3.2 — P2（模型代际）：framework 内部分实现的 shelf-life**

plan 没区分"长期 framework 形态"和"当代实现细节"。例如：
- `chunking helper` / `context compactor` / `token-counter` → context window 跃迁后部分废弃
- `model fallback chain` / `provider switch` → MCP 标准化后简化
- `budget-guard` 当前阈值 → 模型降价后失效

**建议**：每个 framework class 标注 **shelf-life**：
- `STABLE`：mission lifecycle / event-buffer / stage 抽象 / dispatcher pattern
- `TRANSITIONAL`：chunking / cost-discipline / token-counter / 当代 retry 策略
- `TEMPORARY`：specific model fallback chain / 硬编码价格表

瘦身原则补充：**不投入 TEMPORARY 上抽 framework**（不值得，6 月后要重写）。TRANSITIONAL 抽但孤立成可整体替换的 module（不让其他 framework 深度依赖）。

**F3.3 — P3（数据规模）：view-state aggregate 必然变瓶颈**

plan §5.2 设计了 contract shape，但完全没设计：
- 增量计算（incrementally computable）
- caching 策略（snapshot version → diff push）
- pagination（stages[] / events 截断）

**建议**：在 §5.2 contract 设计阶段就标注每字段的 **incremental property**：
- `INCREMENTAL`：只依赖最近 N 事件，可增量计算（如 `cost.totalTokensUsed` += event.tokens）
- `SNAPSHOT`：依赖全量但有快照（如 `stages[]` 来自 stage bindings + 最近事件）
- `FULL_REPLAY`：必须全量 replay 才对（如 `agents[].retryCount`）

`FULL_REPLAY` 字段在 contract review 阶段就要约束（不能让前端把这种字段做成渲染热点）。

**建议** §6.4：「view-state caching 演化路径」
- W2 contract 不强制 cache 实现
- W4 切换前测吞吐基线
- 当 mission events 中位数 > 10K 时启动 cache 设计
- cache key: `(missionId, snapshotVersion)`，前端用 ETag/If-None-Match

**F3.4 — P4（mission 编排演化）：stage 模型可能破产**

plan 假设线性 stage chain（playground 14 stages s1-s12 + s8b/s9b）。但已经有"分支版本"（s8b/s9b）暗示线性不够。未来 mission DAG 形态成熟后：
- `BusinessTeamStageRerunDispatcherFramework` 的 cascade 是基于线性 chain，DAG cascade 算法不同
- `business/stages/` 目录的 14 个文件命名暗示线性，DAG 形态下没意义

**建议** §4.6：「stage 模型演化预案」
- 当前 plan 不重构 stage 模型（不在范围）
- 但 framework 接口预留 `getStageGraph()`（DAG 节点 + 依赖）而不是只有 `getStageList()`
- 未来切 DAG 时，cascade 算法是 swap-in 而不是重写整个 framework

**F3.5 — P5（用户协作演化）：pause / multi-user / collaborative edit**

plan 处理了 rerun，但完全没处理：
- `mission.pause` / `mission.resume`（user 主动暂停 / 继续，与 abort 不同）
- 多用户并发编辑 mission input（input* 字段）
- 协作 ownership（shared mission, multiple editors）

**建议**：在 §3.5 Prisma 字段归属表加 **"未来需要的字段"** 预留：
- `pausedAt` / `pauseReason` / `pausedBy`
- `sharedWith[]` / `editLockHolder`
- 当前 schema 不加，但 contract 设计阶段就明确"这些字段未来会加，framework 端要为它们留挂载点"

**F3.6 — P6（合规可观测）：audit / GDPR / 删除保证**

plan 完全没提：
- mission 数据删除（用户行使 GDPR 删除权时，mission events / artifacts 怎么删）
- 审计日志（leader chat 内容 / 决策 / artifact 内容是否需要永久审计）
- 数据 lineage（artifact 来自哪些事件 / 哪些 LLM 调用 / 哪些 RAG 引用）

**建议** §4.7：「合规接口预留」
- framework 暴露 `forgetMission(missionId, scope)` hook 标准
- contract 字段加 `_audit` namespace（用户可见 vs 仅审计）
- 不强制现在实现，但接口形态留给未来 6-12 月

### 决策可逆性评级（新增）

为 plan §7 W1-W7 每个 Wave 关键决策加可逆性标注：

| Wave | 决策 | 可逆性 | 撤销成本 |
|---|---|---|---|
| W2 | view-state contract 字段 shape | **REVERSIBLE_1_WEEK** | 加字段不破坏，重命名/删字段需 contract version bump |
| W2 | view-state.service 实现 | REVERSIBLE_1_WEEK | 不切前端则无影响 |
| W3 | framework 接管通用骨架 | REVERSIBLE_6_WEEK | feature flag 切回旧 service 实现 |
| W4 | 前端 derive.ts 删除 | **1_WAY_DOOR** | 删了不能复活，要重写。须 R5 emergency runbook |
| W4 | event stream → refresh hint 模式 | REVERSIBLE_6_WEEK | 旧 event 类型不删立刻，废弃期 |
| W5 | chat/dag/export 上提 harness | REVERSIBLE_3_MONTH | framework 类移回 app 是大工 |
| W5 | 前端 todo-ledger.ts 删除 | **1_WAY_DOOR** | 同 W4 derive |
| W6 | 物理重组 mission/ → business/ | **1_WAY_DOOR**（实际可逆但成本高） | 反向 codemod |
| W7 | social/radar 业务团队接入 chat 等 | **DEPENDS_ON_TEAM_AGREEMENT** | 业务团队层级决策 |

**建议**：plan §12 风险章节加可逆性矩阵 + 1_WAY_DOOR 决策的 "决策前 checklist"（contract test 全绿 / equivalence ≥ 95% / emergency runbook 就绪 / 决策权链明确）。

### Outstanding
- F3.5 / F3.6 是否在本 plan 范围还是 separate concern？需用户拍板
- 可逆性矩阵的 1_WAY_DOOR 决策 checklist 是否要在 plan §12 落地？

---

## R4. 可执行性

### Criterion
每个 Wave 至少一个 PR 能在 main 上当下就切出来，所需工具/数据/spec 框架就绪。

### Method
逐 Wave 走"如果今天就要交付第一个 PR，需要什么"。

### Findings

**F4.1 — W2 第一个 PR：contract 类型 + 6 类 mission fixture spec**

工具/数据需求：
- ✅ TypeScript / jest 已就位
- ✅ `playground-event-contract.spec.ts` 模式可参考
- ❌ 6 类真实 mission fixture 数据（不是 mock）—— 5-25 plan §11.2 要"真实 mission fixtures"，但 main 上只有 p4/p5/p6 mock
- ❌ Fixture 从生产环境 anonymize 的工具

**建议** §16.1：「Fixture 数据收集策略」
- 短期：在 dev 环境跑 6 类 mission 场景，dump events + DB snapshot + checkpoint，commit 到 `__fixtures__/` 作为权威 fixture
- 中期：写 fixture-anonymizer 脚本（去 PII / 占位用户/topic ID），从 staging 拉真实 mission
- 长期：fixture 版本管理（contract 变更时 fixture 同步更新）

**F4.2 — W3 第一个 PR：framework 接管 sessions/dedup**

需求：
- ✅ `BusinessTeamMissionDispatcherFramework` 已在 main
- ✅ playground.pipeline.ts (1155 LOC) 内 sessions Map / dedup window 代码段定位明确
- ❌ Equivalence spec 框架——怎么验"接管前后行为等价"？
- ❌ Three-app 同步 PR 工作流——目前 framework class 改一次 = 3 app 同 PR？

**建议** §16.2：「Equivalence spec 框架」
- 模式：旧 service / 新 framework 都跑同一 input fixtures，深 diff 输出
- 工具：jest deep-equal + 现有 `playground-event-contract.spec.ts` 风格扩展
- 模板示例：在新 framework 配套 `*-framework.equivalence.spec.ts`，3 app 各自 fixture

**建议** §16.3：「3-app 同步 PR 工作流」
- monorepo 同 PR：playground / social / radar 改动一次 push（默认）
- 拆分例外：framework 改动太大 → framework PR 先合，3 app 适配 PR 跟随（72 小时 SLA）
- 看护：`agent-team-layout.spec.ts` 加 "framework class signature 改动检测"，3 app 适配状态不全则告警

**F4.3 — W4 第一个 PR：前端 useMissionDetailView 切换**

需求：
- ❌ `GET /missions/:id/view` 后端 endpoint（W2 末 deliverable）
- ❌ `useMissionDetailView` hook（前端新增）
- ❌ Emergency rollback runbook（5-25 plan 不要双跑，但生产必须有回退）
- ❌ Feature flag 框架（不在 mission truth 层双跑，但需在最外 page 层 flag 切新旧 path）

**建议** §16.4：「W4 前端切换前置 checklist」
- W2 完成且 contract test 全绿
- W3 至少 4/6 framework 接管完成
- view-state.service 在 staging 跑 ≥ 7 天，cache 策略验证
- Page-level feature flag 就绪（不是 derive vs view 双跑，是 "fully old page" vs "fully new page" 切换）
- Emergency runbook 写好（§17）

**F4.4 — W5 第一个 PR：chat 上提 + 三 app 同时落地**

需求：
- ✅ `LeaderChatFramework` 设计（§4.2 plan 已写）
- ❌ social / radar 业务团队的 chat hook 实现（A1 决策要求三 app 必做）
- ❌ social / radar 的 leader prompt 设计（业务侧产物）

**建议** §16.5：「Cross-team 协作工作流」
- W5 启动前 social / radar 业务负责人 sign-off "我们将提供 chat hook 实现"
- 不 sign-off 不启动 W5 chat PR（避免 framework 上提但 hook 空挂）
- 三 app hook 实现可以并行，但 framework PR 必须等三方 hook 至少 stub 就绪

**F4.5 — W6 第一个 PR：mission/ → business/ codemod**

需求：
- ❌ Codemod 脚本（ts-morph 还是 jscodeshift？）
- ❌ Import path 映射表
- ❌ 全量 type-check 兜底

**建议** §16.6：「W6 codemod 工具选型」
- 工具：**ts-morph**（TypeScript AST 友好，已有大量项目实例）
- 映射表：W6 启动前预先生成（grep + 手工 verify）
- 验证：codemod 后 `npm run type-check` + `npm run test:quick` + 全量 architecture spec 全绿
- 单次 codemod 全量执行，不分批（避免中间态混乱）

**F4.6 — W7 social/radar 同步 = 业务团队人力依赖**

需求：
- ❌ social / radar 业务团队对本 plan 的 buy-in
- ❌ 三 app 共同的"瘦身验收人"——谁判这是不是真"完成"

**建议** §16.7：「Cross-team governance」
- W0 / W1 阶段 social / radar 团队代表加入 plan review
- 验收人：架构师（plan 拍板）+ 三 app 各一位负责人（业务正确性）
- 每个 Wave 结束做联合 sign-off，记 minutes

### Outstanding
- F4.4 social/radar 业务团队尚未对 chat/dag/export 三 app 复用 sign-off → 用户拍板"是否需要走业务团队协调"

---

## R5. 风险与失败模式

### Criterion
每个失败模式能列举出"我们事先知道这会发生 + 检测信号 + 应急路径"。

### Method
枚举常见和不常见的失败场景，标"概率 / 影响 / 可检测 / 可恢复"。

### 失败模式 Catalog

| # | 失败模式 | 概率 | 影响 | 检测信号 | 应急路径 |
|---|---|---|---|---|---|
| FM1 | W2 contract 字段遗漏 | HIGH | LOW | W3+ 阶段发现某字段需要但 contract 没有 | 新增字段：contract version bump + 6 类 fixture 加测 |
| FM2 | W3 framework 接管引入 regression | MID | HIGH | equivalence spec 失败 / staging 真机回归 | feature flag 回旧 service（保留 6 周） |
| FM3 | W4 前端单轨切换后 P0 bug | LOW | CRITICAL | 用户报告 + 监控（mission 数据展示异常 / API 5xx） | page-level feature flag 回 "fully old page"，rollback SLA ≤ 15 分钟 |
| FM4 | W5 social/radar 业务团队不配合 | MID | HIGH | W4 末或 W5 启动前 social/radar 不响应 sign-off | 退路 A：framework 仍上提但 social/radar 占位 stub（违反 A1 但救命）；退路 B：暂缓 W5，先做 W6 |
| FM5 | W6 codemod 误改 | LOW | HIGH | type-check 失败 / spec 全黑 | revert PR，修 codemod 后重试 |
| FM6 | Wave 中途插队大 feature | MID | MID | PM 通知 / 业务紧急需求 | 三选一：(a) 暂停 Wave，先 ship feature；(b) feature 走旁路（不动 framework）；(c) feature 拆 phase，core 部分先 ship |
| FM7 | Claude 5 / context window 跃迁 | HIGH | MID | Anthropic 发布会 / 业务侧主动迁 | TRANSITIONAL framework class 整体替换（R3 F3.2 已规划） |
| FM8 | 核心 contributor 离职 | LOW | HIGH | 人事变动 | 知识传承：本 plan + review baseline + ADR + decision logs |
| FM9 | view-state.service 性能 dataset 失败 | MID | HIGH | p95 > 200ms / DB load 暴涨 / cache miss > 50% | 临时回 derive（如未 1_WAY_DOOR），中期加 cache + incremental projection |
| FM10 | 三 app 之间 framework 用法漂移 | HIGH | LOW | arch-guard 警告 hook 实现复杂度差异 | Code review 阶段引导 / 季度架构 health check |
| FM11 | hook 数突破 ≤ 5 软约束 | MID | MID | arch-guard AST 扫描 | (a) 砍 hook 让 framework 退回 thin delegate；(b) 评审后破例 + 软约束改 ≤ 6（standard 23 §7 例外流程） |
| FM12 | Standard 23 §6 "3 app 同 PR" 在更多 app 时不可执行 | HIGH | MID | 第 4+ app 接入时 PR 过大 | 切换到 canary + SLA 模式（R3 F3.1） |

### 应急 Runbook 索引（建议 plan §17 落地）

| Runbook | 触发 | 内容大纲 |
|---|---|---|
| RB-W4-rollback | W4 前端切换 P0 bug | feature flag 位置 / 决策权 / 切回步骤 / 通信模板 / 复盘流程 |
| RB-W3-framework-revert | W3 framework 接管 regression | feature flag 切回旧 service / equivalence spec 复跑 / fixture 补 |
| RB-FM4-team-stall | social/radar 团队不响应 | 升级路径 / sign-off 替代方案 / 临时占位 stub 模板 |
| RB-FM6-feature-injection | 大 feature 插队 | 评估流程 / 三种处置选择 / wave 节奏调整公式 |
| RB-FM9-perf-emergency | view-state perf 失败 | cache 紧急上线 SOP / 临时回 derive flag / 监控指标 |
| RB-FM7-model-shift | Claude 5 / context 跃迁 | TRANSITIONAL framework class 替换流程 / shelf-life 标注核查 |

### Findings

**F5.1 — 应急 runbook 全部缺位**

plan §12 风险章节只列风险，没列 runbook。生产事故时无操作手册。

**建议** §17 整章「应急 Runbook 索引」，每条 runbook 至少有：
- Trigger（何时启用）
- Decision authority（谁有权拍板）
- Steps（具体操作清单）
- Communication template（对内 / 对用户通知模板）
- Post-mortem checkpoint

**F5.2 — FM3 / FM9 是 R3 1_WAY_DOOR 决策的关键风险**

W4 单轨切换 + view-state perf 突发 = 最大爆点。当前 plan §12.2 只说"feature flag 6 周"，但 W4 derive.ts 删除是 1_WAY_DOOR，不能简单 flag 切回。

**建议**：W4 前端切换实际形态调整：
- 不删 derive.ts，改为 deprecate（保留代码但不参与主路径）
- 主路径走 view-state，monitor ≥ 4 周稳定后再 delete derive.ts
- delete derive.ts 这一步单独 PR（W4.x），有独立可逆性评估

**F5.3 — FM10 (三 app framework 用法漂移) 是慢性病**

每个 framework 上提了，但三 app 各自实现 hook 时可能用法各异。半年后框架变成"看起来通用但每个 app 都有自己的特殊使用模式"——回退到业务模板反模式。

**建议**：季度做 framework health check（arch-auditor agent 跑）：
- 统计每个 framework class 的 hook 实现行数（差异 > 30% 告警）
- 统计 framework 的 abstract method 调用方分布
- 给"漂移指数"评分，纳入架构债务跟踪

**F5.4 — FM8 (knowledge handoff) 隐性风险**

plan 知识浓度极高（5-25 plan §4 / standard 23 §6 / 本 review baseline / plan v2.0 / ADR 008/009），核心 contributor 离职时新人接手成本大。

**建议** §17.x：「Knowledge handoff 检查」
- 每个 Wave 启动前要求至少 2 人能讲清该 Wave 决策依据
- 关键决策（A1 / A4 / 1_WAY_DOOR 评级）必须有 ADR 记录（不光在 plan）
- ADR / standard 23 / review baseline 三件套作为 onboarding 必读

### Outstanding
- F5.2 W4 derive 不删而 deprecate 的方案，需用户拍板（与 5-25 plan 单轨切换原则有张力）

---

## R6. 汇总：Plan 增量 + 待用户决策

### 6.1 5 轮审视产出的 plan 增量

| 来源 | Plan 增量 | 优先级 |
|---|---|---|
| R1 F1.x | §0 / §W0 / §3.4 / §3.5 / §4.1 / §4.3 / §4.4 / §5.2 调整 | ✅ 已落地 |
| R2 F2.1 | **§5.3 「前端禁区清单」** | HIGH（G1 收口） |
| R2 F2.2 | **§4.5 「engine 层下沉清单」** | MID（G2 完整性） |
| R2 F2.3 | **§3.6 「Wave 间目录中间态」** | HIGH（G3 操作性） |
| R2 F2.4 | §5.4 补 "canonical 抽取算法" | MID |
| R3 F3.1 | **framework hook 标"变更频率"**（HIGH/MID/LOW） | HIGH（演化健壮） |
| R3 F3.2 | **framework class 标 shelf-life**（STABLE/TRANSITIONAL/TEMPORARY） | HIGH |
| R3 F3.3 | **§5.2 contract 字段标 incremental property** + **§6.4 「view-state caching 演化路径」** | HIGH（性能） |
| R3 F3.4 | §4.6 「stage 模型演化预案」 | MID |
| R3 F3.5 | §3.5 加 "未来字段预留" | LOW |
| R3 F3.6 | §4.7 「合规接口预留」 | LOW |
| R3 决策可逆性 | **§12 加 「Wave 决策可逆性矩阵」** | HIGH |
| R4 F4.1 | **§16.1 「Fixture 数据收集策略」** | HIGH（W2 阻塞） |
| R4 F4.2 | **§16.2 「Equivalence spec 框架」** | HIGH（W3 阻塞） |
| R4 F4.3 | §16.3 「3-app 同步 PR 工作流」 | HIGH |
| R4 F4.4 | §16.4 「W4 前端切换前置 checklist」 | HIGH |
| R4 F4.5 | §16.5 「Cross-team 协作工作流」 | HIGH |
| R4 F4.6 | §16.6 「W6 codemod 工具选型 ts-morph」 | MID |
| R4 F4.7 | §16.7 「Cross-team governance」 | MID |
| R5 F5.1 | **§17 整章「应急 Runbook 索引」** | HIGH |
| R5 F5.2 | W4 derive 不删而 deprecate 调整 | HIGH |
| R5 F5.3 | §17.x 季度 framework health check | MID |
| R5 F5.4 | §17.x「Knowledge handoff 检查」 | MID |

### 6.2 待用户决策清单

| # | 决策项 | 来源 | 选项 |
|---|---|---|---|
| D1 | W0 处置 | R1 outstanding | (a) merge 远端分支 / (b) 单独重做 / (c) 跳过直接 W2 |
| D2 | F3.5 multi-user/pause 是否在本 plan 范围 | R3 | (a) 在范围 / (b) separate concern |
| D3 | F3.6 GDPR/audit 是否在本 plan 范围 | R3 | (a) 在范围 / (b) separate concern |
| D4 | F5.2 W4 derive 删除 vs deprecate | R5 | (a) 删（5-25 plan 原版）/ (b) deprecate（保留 4 周再删） |
| D5 | Plan §15-§17 是否本次落地 | R6 | (a) 全部落地 / (b) 仅 HIGH 优先级 / (c) 单独 PR 分批落地 |
| D6 | F4.4 social/radar buy-in | R4 | (a) 我（用户）协调 / (b) 等业务团队 / (c) 先做 framework，buy-in 不到位时退路 A |

### 6.3 5 轮审视的元结论

**plan 通过 R1**（静态对齐 main），**通过 R2**（覆盖 3 目标，但 G1 收口偏窄需补禁区 + G3 缺中间态），**通过 R3**（演化压力大部分可预案但需要标注 framework shelf-life + hook 变更频率 + 可逆性矩阵），**通过 R4**（可执行性但缺 fixture / equivalence spec / runbook 三组工具链），**通过 R5**（风险可识别但应急 runbook 全部缺位）。

**plan 在 5 轮审视后的健康度**：
- Static 健康：9/10
- Goal 覆盖：7/10（差禁区 + 中间态 + canonical 抽取算法）
- Dynamic 健壮：6/10（差 shelf-life / 变更频率 / 可逆性 / cache）
- Executability：5/10（差 fixture / equivalence / runbook）
- Risk hedge：4/10（runbook 全缺位）

**整体**：plan 主体方向正确，但 dynamic 与 executability 两轮揭示明显欠债。在开 W2 worktree 前应至少落地 R3 / R4 / R5 中 HIGH 优先级的 plan 增量。

---

## 7. 下一步

1. **本 review baseline 文档 commit**（永久 reference）
2. **plan 增量分两批落地**：
   - 批 1（W2 启动前必做）：§5.3 禁区 / §3.6 目录中间态 / §15 演化与可逆性 / §16 可执行性补丁 / §17 应急 runbook
   - 批 2（W2 启动后边做边补）：§4.5 engine 下沉 / §4.6 stage 演化 / §4.7 合规 / §5.4 canonical 算法
3. **用户决策 D1-D6 拍板**后再开 W2 worktree

---

**Maintainer**: Claude Code
**Review cadence**: 每个 Wave 结束后做 mini-review，每 3 个 Wave 后跑完整 5 轮
**Next full review**: W3 结束后
