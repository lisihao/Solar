# AI 社媒 ⇄ Playground 对齐重构 · 设计方案

> 状态：v2 已过四路评审，执行中
> 日期：2026-05-21
> 范围：AI Social mission 详情页（前端）+ social 流水线最小后端补线 + 安全脱敏
> 标杆：Agent Playground team 详情页

---

## ⚑ v2 修订（四路评审共识，覆盖以下 v1 全文）

四路评审（architect / reviewer / security-auditor / parity）一致裁决 **approve-with-changes**，并**一致证伪 v1 根因**。以 v2 为执行基准：

### A. 根因纠正（v1 §0/§1/§3 错误）

- 后端**早已接线并在发** `social.agent:thought/action/observation/reflection/error` + `cost:tick`(stage 级)：`social-agent-invoker.service.ts:72-74` + `event-relay.framework.ts:190-376`；9 个 role service 都调 `invoke()`+`tickCost()`。
- **真因 100% 在前端 derive**：① `SocialMissionPage.tsx:431` 用了 research 形状的 `deriveView(events)`；② `derive.ts:168-174,619,663` 的 `KNOWN_AGENT_ROLES` 只认 5 个 research 角色 → 社媒 8 角色事件被 `continue` 丢弃 → `view.agents=[]`；③ `ComputeUsagePanel.tsx:274-282` `StageBars` 硬编码 research stage key → 社媒 `cost.byStage` 全 0。
- 后端**唯一真缺口**：`deps.lifecycle()` 社媒 0 处调用（per-role agent 状态/wallTime 的来源）。`stage:metrics` 不新建——优先前端 derive。

### B. 角色字符串（实测，必须对齐）

后端 kebab → 前端 SOCIAL_TEAM Pascal：`leader→Leader, steward→Steward, platform-probe→PlatformProbe, content-transformer→ContentTransformer, cover-artist→CoverArtist, composer→Composer, polish-reviewer→PolishReviewer, publish-executor→PublishExecutor, publish-verifier→PublishVerifier`。cost stage 标签形如 `content-transform-<platform>`。

### C. 安全 P0（security-auditor，上线前必做）

`publish-executor` / `platform-probe` 的 agent `action.input`/`observation.output`/`thought` **零过滤携带平台凭证**（微信 token / cookie / session / connectionId）。

- 后端：`SocialEventRelay` 覆写 redact 层——action.input 字段白名单（只留 kind/op/toolId）、observation.output 只发摘要、这两个角色的 `thought` 不外发、error.diagnostic / validation.candidateOutput 永不外发。
- 前端 defense-in-depth：derive 对 `publish-executor`/`platform-probe` 不存 thought 文本与 action.input/observation.output 原文（只留统计字段）。

### D. 排期翻转（前端先行，让质变最早出现）

1. **W1（纯前端，零后端风险，出质变）**：重写 `deriveSocialView` 消费已在发的 agent:\* + cost:tick → 产出社媒自己的 `agents[]`(trace/modelId/tokens/iterations/wallTime) + `cost.byStage`；停用 `deriveView(events)`；接通节点卡 / 左栏完成度+最近思考 / 协作动态 / 算力 D-E-F。
2. **W2（前端打磨 + canonical）**：失败/空/加载态改用 `ErrorState`/`EmptyState`/`LoadingState`；任务抽屉补 output/工具/耗时/token；StageBars 适配社媒 stage（社媒专用 compute 视图或最小 prop）；header 实时 wallTime。
3. **W3（唯一后端缺口 + 安全）**：9 个 AI stage 加 `deps.lifecycle()`；`SocialEventRelay` redact 层（C）。
4. **W4（收尾）**：报告体验、参考文献明细、design tokens、i18n、a11y。

### E. 必补可验证目标（reviewer）

- derive 单测：乱序（observation 先于 thought）/ 重复（同事件两次）/ 重放幂等（derive 两次 deepEqual）/ cost 不双计；`SocialAgentState` 须有明确 interface。
- 回归：现有 narrative/stage:lifecycle 流不破；playground 的 ComputeUsagePanel/MissionFlowView 喂社媒数据不反向影响 playground（不改 playground 文件，必要 prop 须 default 保持原行为）。
- 验收强标准（parity）：报告可读 + 错/空/载态 canonical + 首屏实时反馈，不止"5 tab 有内容"。

### F. 待用户拍板（已收敛）

- 协作动态：**复用 MissionFlowView**（先读其对 view 形状耦合面；若只读 agents/cost/timeline 则喂社媒 derive 产物，不改 playground）。
- StageBars：社媒**独立 compute 视图** vs 给 ComputeUsagePanel 加最小 prop —— 倾向独立视图（不碰 playground）。

---

---

## 0. 一句话

社媒和 Playground 的质量差距**根在数据粒度，不在 UI 皮肤**：社媒后端把每个 stage 内部已经算出的 agent 轨迹（thought/action/observation/iterations/tokens）丢弃了，只发了 ~13 种粗事件。重构 = **后端选择性补发已有数据（接线，非重写）+ 前端 derive/UI 升级到真实数据驱动**。

---

## 1. 根因（三路审计交叉印证）

| 维度                     | Playground                                                                                                                   | AI 社媒                                                               | 证据                                                                                                  |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 后端事件种类             | 80+（agent:thought/action/observation/reflection、cost:tick/stage、iteration:progress、dimension/chapter、verifier:verdict） | ~13（多为 social.agent:narrative + stage:lifecycle 二元态）           | `social.config.ts:28-157`、`social-pipeline-dispatcher.service.ts:544-578`、`narrative.util.ts:74-87` |
| 前端 derive 产物         | AgentLiveState(trace/modelId/tokens/iterations/wallTime) + DimensionPipelineState + VerifierVerdict + CostState.byStage      | SocialStageView(status/时间) + SocialRoleView(status)                 | `agent-playground/derive.ts:190-318` vs `ai-social/derive-social.ts:24-52`                            |
| 协作动态 tab             | MissionFlowView 真事件流                                                                                                     | MissionFlowView **空跑**（无 agent:lifecycle/narrative 角色逻辑配套） | `SocialMissionPage.tsx:902-915`                                                                       |
| 算力消耗 tab             | ComputeUsagePanel 6 段（含 per-agent/per-tool/浪费分析）                                                                     | 同组件但 `view.agents=[]` → D/E/F 段全白                              | `SocialMissionPage.tsx:951-964`                                                                       |
| 节点卡 / 左栏 / 任务抽屉 | AgentInspector 富卡 + 完成度% + 最近思考 + Consensus                                                                         | 仅 label/icon/status；抽屉仅 3 字段                                   | `SocialMissionPage.tsx:651-899`                                                                       |

**决定性事实**：社媒 stage 内部真的跑了 AgentRunner，`r.events`（thought/action/observation）+ `r.iterations` + token 已算出，但只有 token 总和进了 budget pool，其余丢弃。`EventRelayFramework`（`ai-harness/teams/business-team/relay/event-relay.framework.ts:186-264`）已支持 agent 事件 → domain 事件翻译，**社媒没接线**（`social-agent-invoker.service.ts:54-75` 的 onEvent 未串到 relay）。

---

## 2. 目标态 = Playground 能力 checklist（社媒逐项对标）

- [ ] 左栏：组织图 + 每角色完成度 + 最近思考 + Mission progress + （社媒版）质量信号
- [ ] 节点卡：AgentInspector 富卡（状态统计 / 负责阶段 / 模型 / 工具 / 最近思考）— **已部分落地（真实数据版）**
- [ ] 任务列表抽屉：阶段 output / 工具 / 耗时 / token / 失败详情
- [ ] 协作动态：真实 narrative + lifecycle + 阶段 stepper 时间线
- [ ] 算力消耗：总览 + per-stage + per-model + per-tool + 浪费分析（真实数据）
- [ ] 输出报告 / 参考文献：版本/明细化（社媒以平台版本 + 来源明细对齐）

---

## 3. 架构方案抉择（关键，需用户拍板）

### 方案 A — 纯前端美化（否决）

仅用现有薄数据把 UI 做漂亮。无法补出 model/token/iteration（narrative 是自然语言）。**不解决根因，用户已表达不接受"低配版"。**

### 方案 B — 后端全量补发（过度设计）

新增 10+ 事件，改 12 个 stage，与 research/teams 完全齐平。成本高、收益边际递减；社媒本质是固定流水线，不需要 dimension/chapter 那套。**违反 YAGNI。**

### 方案 C — 后端选择性补发 + 前端 derive/UI 升级（推荐）

复用现有 `EventRelayFramework` 基础设施，补发 6-8 个**已算出**的事件；前端重写 derive-social 为富模型，UI 用真实数据驱动。**~70% 丰富度，零重写风险，MECE 干净。**

补发事件清单（方案 C）：

1. `social.agent:lifecycle`（每个 role agent 的 started/completed/failed + wallTimeMs + iterations）
2. `social.agent:thought`（含 modelId）
3. `social.agent:action`（toolId/input）
4. `social.agent:observation`（output/latencyMs/tokensUsed）
5. `social.cost:tick`（**stage 级** token/cost，当前仅 mission 级）
6. `social.stage:metrics`（stage 完成元数据：耗时/迭代/产出大小）7.（可选）`social.agent:error`（失败堆栈）

> 落点均在 `ai-app/social/**` 内补线 + 复用 `ai-harness` relay，依赖方向 L3→L2.5 合规，不反向、不穿透 facade。

---

## 4. 分波重构计划（每波带可验证目标）

### W1 后端接线（数据地基）

- 串 `social-agent-invoker` 的 onEvent → relay，开启 agent:thought/action/observation 转发（社媒前缀）
- 补 `social.cost:tick`（stage 级）+ `social.stage:metrics` + `social.agent:lifecycle`
- **verify**：对一个真实任务，WS 流里能抓到上述事件类型且 payload 字段非空；`npm run test:quick` 后端绿；不破坏现有 narrative/stage:lifecycle
- **红线**：复用 EventRelayFramework，不新建并行通道；不阻塞主流水线（fire-and-forget emit，`void`）

### W2 前端 derive-social 富化

- 重写 `derive-social.ts`：在现有 stage 模型上叠加 per-role `SocialAgentState`（trace/modelId/tokens/iterations/wallTime），并产出 `cost.byStage`、role→agent 聚合
- **verify**：对录制的事件序列，纯函数 derive 出非空 agents/cost.byStage；新增 derive 单测全绿；幂等可重放

### W3 前端 UI 对齐（真实数据驱动）

- 节点卡 AgentInspector：从薄数据 → 真实 trace/model/tool/最近思考（**当前已落地"只填真实数据"版，W3 升级为接 W2 富数据**）
- 左栏：完成度% + 最近思考 + Mission progress（社媒版）
- 任务抽屉：阶段 output / 工具 / 耗时 / token / 失败详情
- 协作动态：真实时间线（修 MissionFlowView 社媒角色适配，或社媒专用 FlowView）
- 算力消耗：ComputeUsagePanel D/E/F 段接真实 agents/cost
- **verify**：5 个 tab 均有真实非空内容；`npm run audit:ui-discipline` 不涨基线；canonical 组件优先（违规需用户批准）

### W4 收尾打磨

- 输出报告/参考文献明细化；token/间距/状态色走 design tokens；i18n（radar 同款 namespace 规范）；a11y
- **verify**：`npm run verify:changed` 全绿；UI discipline 0 违规；i18n 0 单花括号占位

---

## 5. 风险与红线（CLAUDE.md 对齐）

- **反向洞察 10 条**：W1 涉及事件发射/relay，须遵守 fire-and-forget `void`、不在子事务里发、错误路径不吞（catch 要 emit failure）
- **MECE / 分层**：后端改动只在 ai-app/social + 复用 ai-harness relay；前端只走 facade；不新建模块/入口文件
- **安全**：agent thought/observation 进入前端 = 新增对外暴露面。**必须评审：thought/observation payload 是否可能携带 PII / BYOK 密钥 / 原始工具响应敏感内容**，需在 relay 翻译层做裁剪/脱敏
- **复用优先**：节点卡/抽屉/空态/Tab 一律先查 canonical（标准 22），缺口停下来问用户
- **范围**：不顺手改 playground 文件（社媒"复用不修改"原则，必要时加最小适配层）

---

## 6. 待用户拍板的关键决策

1. **方案选 C（推荐）还是 B（全量齐平）/ A（纯前端）？** — 决定要不要动后端
2. **协作动态**：修 `MissionFlowView` 兼容社媒角色（改公共组件，影响 playground）还是**新建社媒专用 FlowView**（不碰 playground，但多一个组件）？
3. **安全脱敏强度**：agent thought/observation 对外暴露，做"全文透传"还是"摘要+裁剪"？
4. **执行节奏**：4 波串行交付（每波可验证后再下一波）还是一次性大 PR？

---

## 7. 附：核心文件索引

后端：`social.config.ts` / `social-pipeline-dispatcher.service.ts:179-290,544-578` / `social-agent-invoker.service.ts:54-75` / `event-relay.framework.ts:186-264` / `narrative.util.ts:74-87` / `agent-playground.event-schemas.ts:354-436`（payload 可复用）
前端：`SocialMissionPage.tsx` / `derive-social.ts` / `derive-social-stages.ts` / 复用 `agent-playground/{MissionFlowView,ComputeUsagePanel}` / `common/agent-inspector`
