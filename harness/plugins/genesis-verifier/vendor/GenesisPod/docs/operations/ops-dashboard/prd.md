# GenesisPod 运营看板 PRD（基线稿 v1.0）

> 状态：**基线稿 v1.0**（已过 4 维度系统评审 + 评审主席综合，核实 load-bearing 事实后定稿）。
> 视角：资深运营总监。目标：让运营能"看到数 → 做出动作"，不是堆图表。
> 评审结论：方向扎实，2 blocker + 7 必改已在本稿落实，judged **ready-for-W1**。评审明细见附录 B。

---

## 0. 一句话目标

为 GenesisPod 建一个**运营总监级看板**：第一眼看清「北极星活跃 + 单用户成本/毛利 + 模块健康 + 主题冷热」，每个异常数都能下钻、能触发运营动作（召回名单 / 选题缺口 / 成本异常告警）。

## 1. 成功标准（强验证目标，可独立循环）

| #                  | 目标               | 验证标准                                                                                                          |
| ------------------ | ------------------ | ----------------------------------------------------------------------------------------------------------------- |
| G1                 | 统一用户事件可落库 | `user.event` emit → 批量 flush → `user_events` 表，listener 单测全绿（含背压/失败重试上限）；手动 emit 能查到记录 |
| G2                 | 跨模块漏斗可拼     | 注册→进模块→发起→产出→沉淀 5 段漏斗，数值与手算一致（±0）；丢失事件可由 W3 cron 从业务表状态回填对账              |
| G3                 | 留存曲线可出       | 注册 cohort D1/D7/D30 **+ 首次成功产出 cohort（activated retention）周留存**，跑批结果与手算抽样一致              |
| G4                 | 模块健康可比       | 11 模块横表：活跃/发起/完成率/失败率，数值对得上业务表（耗时口径见 §6 例外说明）                                  |
| G5                 | 成本可下钻         | 单用户/单模块/单模型 token 与成本，**100% 以 AIEngineMetric 为唯一真源**，对账一致                                |
| G6                 | 看板不拖垮线上库   | 看板 API 全部只读预聚合表，P95 < 300ms，**禁止调用 getOverviewStats / 任何无时间窗全表 count**                    |
| G7（依赖 revenue） | 单用户毛利         | 毛利 = 实付 − 成本，与财务对账一致（**前置：货币 revenue 数据源确认**；阻塞期用积分口径出相对 ROI）               |

## 2. 北极星与口径（先定义，避免上线吵架）

- **北极星 = 产出型周活（PWAU）**：本周内产生 **≥1 次「可沉淀/可分享/可导出的产物」事件**的用户数。
  - 分子口径（收紧后，与事件字典自洽）：`action ∈ {completed, saved, published}` 且 `resourceId` 非空。
  - **明确排除**：ai-ask 的 `started`（发消息）、explore 的 `viewed`（浏览）—— 这些是轻动作，计入辅助活跃但**不计入北极星**，防止水聊天/划水灌高北极星。
  - `success` 三态：北极星只认 `success=true`；`success=null` 不计入成功产出。
- **配对护栏指标（防为刷北极星牺牲质量）**：① 首次成功产出后次周留存（activated retention）；② 产物复用率（产物被再次打开/编辑/导出/分享比例，W5 呈现）。北极星与护栏必须同屏看。
- **活跃口径三选一，统一为「产出型」**：产出型（主口径，见上）/ 登录型（辅口径，`LoginHistory`/`lastLoginAt`，仅做"来了没干活"对比）。**禁止登录当北极星**。
- **"一次任务"口径**：`action=started` 计发起，`action=completed` 计完成，完成率 = completed/started（同 `resourceId` 维度）。`started` 以哪个真实状态跃迁为准，见 §4.2 映射表（**禁止把 PENDING「已创建未跑」当发起**，否则分母虚高）。
- **「高价值用户」口径（召回名单依赖）**：累计成功产出次数 ≥ N，或累计积分/token 消耗 Top X%（N/X 上线前与运营定标，先默认 N=5 / Top 10%）。第二屏"7 天未回流高价值用户"导出按此口径。

## 3. 范围与分波（每波可独立验证、独立合并）

| 波次   | 内容                                                                                                                                                                               | 业务侵入                                   | 验证              | 风险                                                                      |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ----------------- | ------------------------------------------------------------------------- |
| **W1** | `UserEvent` 表 + 手写迁移 + 事件字典/payload 类型（`common/`）+ `UserEventListener`（批量缓冲 flush **+ 背压三件套**，挂进 `common/observability` 的 `ObservabilityModule`）+ 单测 | **零**（不碰 11 模块、不碰 app.module.ts） | G1                | 低                                                                        |
| **W2** | 11 模块关键节点加 `void this.events.emit('user.event', …)`（**含 source/channel 注册埋点、search 埋点**）                                                                          | 极低（每处 1 行）                          | 各模块 e2e 不回归 | **中**（触及业务代码，逐文件白名单 + payload 字段表下发 + 主 Agent diff） |
| **W3** | `operation_metrics_daily` + `@Cron` 预聚合（放 admin/dashboard service 层）+ cohort 留存 **+ 从业务表状态回填对账**                                                                | 零（新建）                                 | G2/G3/G4          | 低                                                                        |
| **W4** | Revenue 映射表 + 单用户毛利 API（**前置货币 revenue 数据源**；阻塞期用积分口径相对 ROI）                                                                                           | 零（新建）                                 | G7                | 被数据源阻塞                                                              |
| **W5** | 看板查询 API（`open-api/admin/dashboard`）+ 前端 4 屏（复用 `/admin` 壳 + recharts）                                                                                               | 零（新建）                                 | G5/G6             | 低（**新模块/路由由主 Agent 建骨架**）                                    |

> **本次 workflow 只执行 W1**（零业务侵入、可独立验证）。

## 4. 详细设计

### 4.1 数据模型：`UserEvent`（已删除成本冗余列 — blocker#2）

```prisma
model UserEvent {
  id           String   @id @default(uuid())
  userId       String   @map("user_id")
  module       String   // ai-research / ai-teams / ai-office / ai-writing / ai-ask / ai-image / ai-social / topic-insights / library / explore
  action       String   // started / completed / failed / saved / shared / published / viewed
  resourceType String?  @map("resource_type")
  resourceId   String?  @map("resource_id")
  topicKey     String?  @map("topic_key")     // 归一后的主题键，支撑主题运营（W2 起填充）
  success      Boolean?                         // 三态：null 不计入成功产出
  metadata     Json?                            // 承载 channel/source（W2 注册埋点预留）
  createdAt    DateTime @default(now()) @map("created_at")

  @@index([userId, createdAt])
  @@index([module, action, createdAt])
  @@index([topicKey, createdAt])
  @@map("user_events")
}
```

设计要点 / 评审落实：

- **删除 `tokens` / `costUsd`**（评审 blocker#2）：成本是毛利减数，UserEvent 是 mission/action 粒度、AIEngineMetric 是每次 LLM 调用粒度，一次 mission 内 N 次调用 → N 行 AIEngineMetric；若 UserEvent 再写 mission 累计成本，任何 `UNION SUM` 会双计。**成本聚合/对账/毛利 100% 以 `AIEngineMetric` 为唯一真源**，成本下钻按 `userId + resourceId(missionId)` JOIN AIEngineMetric（`@@index([userId, createdAt])` 支撑）。看板 cost 聚合 SQL **禁止 UNION UserEvent**。
- `module/action` 用 **string 而非 enum**：真实库各模块 status 枚举互不一致（`MissionStatus`/`ResearchMissionStatus`/`WritingMissionStatus` 值集不同），UserEvent 用 enum 反而无法统一；取值由 §4.2 的 TS 常量字典约束防脏数据。
- 与现有 `UserActivity`（`user_activities`，前端资源浏览埋点 VIEW/scrollDepth）**语义边界**：UserEvent = 后端跨模块业务动作流（module/action/success），UserActivity = 前端资源浏览。表名不冲突，**禁止合并或重复埋点**。
- **外键取舍**：运营审计表不建 `User` 外键（避免删用户连锁删审计数据），W1 schema 评审最终确认。
- 手写 SQL 迁移建空表 + 普通 `CREATE INDEX`（评审确认：空表无需 `CONCURRENTLY`，`CONCURRENTLY` 反而在 `prisma migrate deploy` 事务内会被静默回滚 —— 那是给已有大表加索引的坑，本波建空表不触发）。

### 4.2 埋点策略（非侵入，复用现有事件总线）+ status→action 映射表

```
业务模块关键节点  →  void this.events.emit('user.event', payload)   // fire-and-forget，1 行
                          ↓
            UserEventListener  @OnEvent('user.event')   // 挂在 common/observability 的 @Global ObservabilityModule
                          ↓
            内存缓冲 + 背压三件套  →  定时 flush（5min 或 ≥500 条）  →  prisma.userEvent.createMany
```

- 复用现有 `EventEmitter2`（与 `llm.cost.record` 同范式）；落库逻辑参考 `CostAttributionService` 批量 flush，**但必须补背压三件套（见下，评审 must-fix#7）**。
- 对业务模块侵入 = 每个关键节点加 1 行 `void this.events.emit(...)`，**不改构造函数、不改 module.ts、不改 app.module.ts/入口文件**。
- emit 一律 `void`（满足 `no-floating-promises`）；listener 落库失败只 warn 不抛（运营埋点不得拖垮业务主链路）。

**flush 背压三件套（不能直接照抄 CostAttributionService — 它无上限）：**

1. **buffer 上限**：≥5000 条触发丢弃最旧 + warn 计数（保护进程不 OOM）。
2. **失败重试有上限**：超限丢弃并 warn，不无限 `unshift` 递归 drain（DB 持续抖动时防 OOM）。
3. **幂等**：`skipDuplicates` 在随机 uuid 主键上是 no-op（不去重），**去掉以免误导**；如需重启幂等，另加业务唯一键（`module+action+resourceId+时间窗`）配 `@@unique` 才生效 —— W1 先去掉，可靠性靠 W3 业务表回填对账兜底。

**关键事件可重建分级（评审 must-fix#1）：** `started/completed/failed/published/saved` 这类决定漏斗与北极星的关键 action，缺口由 W3 cron 从业务表 `status + createdAt/completedAt` 回填对账（业务表是真值源）；`viewed` 这类高频低价值事件才允许纯内存缓冲容忍丢失。

**事件字典 + status→action 映射表（逐模块写死真实枚举，评审 must-fix#4）：**

| module         | 真实 status 枚举 → action                                                                                 | 触发点                   | 完成率/失败率口径          |
| -------------- | --------------------------------------------------------------------------------------------------------- | ------------------------ | -------------------------- |
| ai-research    | `ResearchMissionStatus`: EXECUTING→started, COMPLETED→completed, FAILED→failed（无 PENDING）              | ResearchMission 状态跃迁 | 适用                       |
| ai-teams       | `MissionStatus`: IN_PROGRESS→started, COMPLETED→completed, FAILED→failed（PLANNING/PENDING 不算 started） | TeamMission 状态跃迁     | 适用                       |
| ai-writing     | `WritingMissionStatus`: IN_PROGRESS→started, COMPLETED→completed, FAILED→failed                           | WritingMission 状态跃迁  | 适用                       |
| ai-office      | `OfficeDocumentStatus`: GENERATING→started, COMPLETED→completed（**无 FAILED**）                          | OfficeDocument 状态跃迁  | **失败率不适用（恒 0）**   |
| ai-image       | `GeneratedImage` 无 status（只 createdAt）：行存在=completed                                              | 图片产出                 | **完成率/耗时不适用**      |
| ai-ask         | `AskSession`/`AskMessage` 无 status：**钉死 AskMessage 创建=started**                                     | 每条用户消息             | 仅辅助活跃，**不计北极星** |
| ai-social      | `SocialContentStatus`: PUBLISHED→published, FAILED→failed                                                 | SocialContent 发布       | 适用                       |
| topic-insights | 同 ai-research 范式                                                                                       | TopicReport 生成         | 适用                       |
| library        | Collection/Note 创建=saved                                                                                | 内容沉淀                 | 沉淀计数                   |
| explore        | `ActivityType`（大写）: VIEW→viewed, SHARE→shared（**大小写归一**）                                       | UserActivity             | 仅辅助活跃                 |

> 字典 + payload 类型（`module/action/resourceType/resourceId/topicKey/success/metadata`）放 **`common/observability/user-event.types.ts`**（评审定论 must-fix#2）：所有 emit 方（11 个 ai-app）与 listener 都能合法 import；放任一 ai-app 内部会触发"ai-app 不得跨 app import"断言。

### 4.3 预聚合层（W3，放 admin/dashboard service 层 — 非 ai-infra）

- `operation_metrics_daily(date, metric_key, dim_key, dim_value, metric_value, created_at)`，唯一约束防重，`ON CONFLICT` 幂等。
- `@Cron("0 2 * * *")` UTC：聚合前一日 `user_events` + `AIEngineMetric` + `User` 新增。**Scheduler 类放 `open-api/admin/dashboard`（或 `ai-app/operations`）service 层**——业务感知层，**禁止放 ai-infra**（L1 必须业务无关，跨 11 模块/topicKey 语义会触发 jest 断言 + pre-push 拒推，评审 blocker#1）。
- **从业务表状态流转回填对账**：cron 同时 reconcile `user_events` 缺口（业务表 status+时间戳为真值源），兜底 flush 丢失。
- 留存：注册 cohort + **首次成功产出 cohort（activated retention）**，产出 D1/D7/D30 + 周留存。
- 抄 `StorageInventoryService` 的快照范式（每日落库 + 保留窗口 + 重入保护）。

### 4.4 Revenue 与毛利（W4，前置阻塞）

- **数据源现状（评审核实）**：全库**无 Subscription/Payment/Order/Invoice 模型**；`User` 仅 `subscriptionTier`(string 'free') + `subscriptionExpiresAt`，无实付金额字段；`CreditAccount.totalSpent`(Int) 与 `CreditTransaction.amount`(Int) **均为积分非货币**（注：`totalSpent` 在 `CreditAccount`，不在 `CreditTransaction`）。→ **货币毛利算不出，W4 阻塞**，结论成立。
- **阻塞期不留空**（评审 ops must-fix#2）：用积分消耗 + 充值流水做**「代理收入」**，先出**积分口径**的单用户/单模块/单主题相对 ROI（明确标注口径=积分），让 MVP 能做相对排序决策；货币真账到位后切换。
- 真账设计：`subscription_revenue`（档位→金额）+ 用户实付记录 → 货币毛利 = 实付 − Σcost(AIEngineMetric)。

### 4.5 看板 API + 前端（W5）

- 后端：`open-api/admin/dashboard` 只读端点（`/kpi-snapshot`、`/trend/:metric`、`/funnel`、`/cohort`、`/modules`、`/topics`），**只读 `operation_metrics_daily` 预聚合表**，不直接调 harness 内部 service（避开 facade 穿透）。
- **与 `getOverviewStats` 物理隔离**：运营 controller 不注入 `StatisticsService`，端点禁调任何无时间窗全表 count（`getOverviewStats` 是 Promise.all 约 30 个全表 `.count()`，会随数据量线性变慢），配 review/lint 护栏（G6 可执行护栏）。
- 前端：`/app/admin/operations` 新页面，复用 `AdminPageLayout` + `admin-tables.tsx`（StatGrid/DrawerShell）+ recharts。图表壳若无 canonical **停下问用户，不静默自写**（前端 UI 复用红线）。
- **新模块骨架、新页面路由由主 Agent 创建**（Sub-Agent 红线）。

### 4.6 listener 与事件定义归属（评审定论）

- **listener → `common/observability`**：加进已 `@Global` 且全局加载的 `ObservabilityModule` 的 `providers`（当前只 provide `MetricsService`）。因模块已全局 import，listener 即被 EventEmitter 自动注册，**W1 真正零侵入、不碰 app.module.ts**。**不新建独立 `UserEventModule`**（那需 app.module.ts import 才生效，触碰入口文件红线）。
- **事件字典 + payload 类型 → `common/observability/user-event.types.ts`**（见 §4.2）。
- 论断"`user.event` 是 app 层 product-analytics 语义、不应进 engine/harness"**成立**：`ai-harness/tracing` 的 `llm-events.listener` 订阅的是 `llm.span/llm.cost` 模型调用层 trace，语义正交；`common` 可被所有层 import 且不受"业务唯一名"断言约束，是最干净落点。

### 4.7 权限

- 复用 `AdminGuard`。看板只读归 admin 权限；细分 `OPERATOR`/`ANALYST` 角色留 P2，不进 MVP。

## 5. 架构归属与合规（评审修订后）

- 运营看板是**跨模块只读消费方**：看板 API + 聚合 scheduler 归 **`open-api/admin/dashboard`**（L4，可任意方向依赖）；事件定义/listener 归 **`common/observability`**（共享层，所有层可用、不受业务名断言）。
- **严禁**把聚合 scheduler 放 `ai-infra`（L1 业务无关，blocker#1）。读 `AIEngineMetric` 走 Prisma 只读 OK（DB model 非 layer import）。
- 严守分层单向：不反向依赖 ai-app，不污染 ai-engine / ai-harness。

## 6. 看板布局（4 屏）

```
第一屏 经营总览  北极星 PWAU + 护栏(activated留存/复用率) · 单用户成本 · 毛利(积分口径,货币待W4) · token成本趋势 · 模型分布 · 今日新增/活跃 · (ARPU/stickiness 见 W2+)
第二屏 增长漏斗  注册→激活→留存(注册cohort + activated cohort)→付费转化；导出"7天未回流高价值用户"名单(高价值口径见§2)
第三屏 模块健康  11 模块横表：活跃/发起/完成率/失败率；主行动=点失败率高模块下钻失败case。耗时仅对有 started/completed 时间戳模块算(office/image 例外留空)
第四屏 主题运营  热门主题排行 · 主题相对ROI(积分口径)；冷启动缺口=需求侧(search/started)/供给侧(completed)比值 —— 需 W2 补 search 埋点，补齐前标注"仅热榜"
```

> 每屏一个主行动（评审 ops should-fix）：总览→成本告警；漏斗→导出召回名单；模块健康→下钻失败 case；主题→导出建议选题清单。

## 7. 风险与红线对照

- **R1 埋点拖垮业务**：listener 异步缓冲 + 失败只 warn + emit `void` + **背压三件套**（§4.2）。
- **R2 事件丢失致漏斗缺口**：关键 action 由 W3 cron 从业务表状态回填对账（§4.3）。
- **R3 触及 11 模块（W2）**：逐文件白名单 + payload 字段表下发 + 主 Agent diff，单独分批。
- **R4 实时扫表拖垮库**：看板只读预聚合表，与 `getOverviewStats` 物理隔离（§4.5）。
- **R5 口径不统一**：§2 北极星/活跃/任务/高价值口径 + §4.2 status→action 映射表先定义。
- **R6 成本双计**：AIEngineMetric 唯一真源，禁止 UNION UserEvent（§4.1）。
- **R7 架构违规拒推**：聚合不放 ai-infra，listener/字典放 common，新模块/路由主 Agent 建（§5）。
- **R8 Sub-Agent 越权**：workflow agent 走 worktree 隔离 + 绝对路径 + verify barrier + 合并前逐文件 diff。

---

## 附录 A：现状盘点（探子实读，非猜测）

**✅ 现成可用**：Token/成本全链路（`AIEngineMetric` 三层持久化，按 `userId/operationId(模块)/modelId/providerId` 四维归因，`model-pricing.registry` 单价表含缓存价，入口 `ai-chat.service.ts:2019 emitCostRecord`）；`CreditTransaction`（积分流水）；11 模块产物表多有 status+时间戳；`open-api/admin` + `AdminGuard` + 20+ 前端页面 + recharts v3.4.1 + `@Cron`/SchedulerRegistry + Storage 每日快照范式 + Redis CacheService；`EventEmitter2` + `cost-attribution.service.ts` 批量 flush 范式（**注意：无背压上限，本方案补齐**）。

**⚠️ 要加工**：活跃口径三处需统一（§2 已定）；主题字段分散需 `topicKey` 归一；`getOverviewStats()` 实时全表 COUNT 不可复用。

**❌ 硬缺口**：货币 revenue 真账缺失（无 Subscription/Payment，只有积分）→ 货币毛利 W4 阻塞；无统一用户事件流（W1/W2 解决）；留存只有 lastLoginAt 单点（W3 cohort 解决）。

---

## 附录 B：评审记录（系统评审 wf_5a2b553a，4 维度 + 主席综合）

| 维度            | 结论                                            | 关键落实                                                                                                                         |
| --------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 运营总监视角    | pass-with-changes                               | PWAU 收紧+护栏(§2)、积分口径代理收入(§4.4)、activated留存+高价值口径(§2/G3)、冷启动缺口需 search 埋点(§6 W2)                     |
| 架构合规        | pass-with-changes                               | 聚合移出 ai-infra→admin/dashboard(§5 blocker#1)、listener+字典放 common(§4.6)、看板与 facade/getOverviewStats 隔离(§4.5)         |
| 数据/成本正确性 | pass-with-changes                               | 删 UserEvent 成本列/AIEngineMetric 唯一真源(§4.1 blocker#2)、status→action 映射表(§4.2)、修正 totalSpent 字段位置(§4.4)          |
| 实施风险        | pass-with-changes                               | flush 背压三件套(§4.2 must-fix#7)、关键事件 W3 回填对账(§4.3)、listener 挂 ObservabilityModule 零侵入(§4.6)                      |
| **主席综合**    | **needs-revision → 已落实 9 项 → ready-for-W1** | 2 blocker + 7 must-fix 全进本稿；8 项推迟 W2+（ARPU/stickiness、渠道 source、复用率、search 埋点、外键、P95 口径、看板隔离实现） |

## 附录 C：实施进度

- **W1 ✅ 已完成并落主仓工作区（2026-05-30）**。worktree 隔离开发 + 对抗审查(verdict=pass) + 主仓独立核验：
  - 落地 6 文件：`UserEvent` model（models.prisma 末尾新增，未动现有 model）、手写迁移 `20260530_add_user_events/migration.sql`、`common/observability/user-event.types.ts`（字典 + status→action 映射表 + resolveAction）、`user-event.listener.ts`（背压三件套）、`observability.module.ts`（仅加 provider，未碰 app.module.ts）、单测。
  - 验证：`prisma generate` ✓ · `type-check` exit 0 ✓ · `verify:arch` 31 套件/351 测试 ✓ · 单测 11 passed（含 resolveAction 映射表 + 背压#1 直接断言）✓。
  - **状态：代码就绪，未 commit/push**（commit 与推送留待确认）。
- **W2 下发材料就绪**：见 `w2-emit-plan.md`（11 模块点位 + payload 字段表 + 侵入度修正 + 分批建议 W2-a/b/c）。research 行号缺口已 close；explore 为空缺口单列 W2-c；office 落点 OfficeDocument vs Slides 待 W2 启动时对齐。
