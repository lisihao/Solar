# 一人公司操作系统（One-Person Company OS）· 设计方案

> 状态：**部分被取代（Superseded in part）**　·　最后更新：2026-06-08　·　范围：产品愿景 + 信息架构 + 架构映射 + 分期里程碑
>
> ⚠️ **当前主流模型以 [英雄（Hero）模型重构方案](../../architecture/opc-hero-model.md) 为准（2026-06-08 用户拍板）。**
> 本文所述"招人 → 组队 → 任命 Leader → 配 CEO → 多 Team 协同"的组织模型，已**降级为隐藏的进阶 / 兼容路**（数据层 `CompanyMission.team_id` 改可空 + 新增 `hero_id`，二选一；旧 team/agent/workflow 表保留但英雄主流程不碰），**不再是默认产品方向**。董事长只做两步：**① 收英雄 ② 给英雄配模型**；下任务给英雄，英雄（领域指挥官 capability）自动拉起兵种干活。
>
> - **仍然有效**：§6 后端映射、§10 后端实现架构、附录源码锚点——capability / harness 复用结论不变，英雄模型正是建立其上（`marketplace/capability` + `deep-insight` 即第一个英雄）。
> - **已被英雄模型取代**：§1 愿景、§2 组织模型、§3 命名（智能体市场→**英雄市场**、我的团队→**我的英雄**）、§4 信息架构、§5 内容明细、§7 里程碑（M3「CEO + 多 Team Campaign」已收起为进阶路）、§9 决策——一律以 opc-hero-model.md 为准。

---

## 1. 愿景与隐喻

> ⚠️ **已被英雄模型取代**（见顶部横幅 + [opc-hero-model.md](../../architecture/opc-hero-model.md)）：下述"董事长 → 管理团队 → 多 Agent Team"组织隐喻为进阶/兼容路，非当前默认。主流隐喻：用户＝团长/CEO，**英雄＝领域指挥官 capability**，英雄自带兵种（Researcher/Writer/Reviewer…）。

为「一人公司」的用户提供一套操作系统：**用户是董事长，平台里的 Agent Team 是下面的执行单位**。

- Agent 是被预定义、可"招聘"的员工，自带技能、工具与生态对接能力。
- 用户挑选 Agent 组建 Team、任命 Leader，给 Leader 布置任务。
- 用户可建多个 Team，Team 之间基于任务协同。
- 最终：董事长 → 管理团队 → 各执行 Team，一家会自我运转的公司。

---

## 2. 组织模型

```
董事长（用户，唯一的人）
  └─ 管理团队（虚拟）= CEO ＋ 各 Agent Team 的 Leader 组成
        ├─ Agent Team A：Leader + 成员 Agent
        ├─ Agent Team B：Leader + 成员 Agent
        └─ ...
  团队共享资源（独立，跨 Team 复用）：团队工具 · 团队技能 · 团队工作流
```

关键概念：

- **管理团队（虚拟团队）**：CEO ＋ 各 Agent Team 的 Leader 组成。董事长只直接面对这一层"高管"，CEO 往下统管各执行 Team。**这是"多 Team 协同"的组织化表达**。
- **CEO**：用户可任命的一个"职业经理人"Agent，替董事长统管多个 Team、做跨部门协调。可选——不任命时由董事长直接对各 Leader。
- **Agent Team**：执行单位。一个 Leader + 若干成员 Agent，配一套工作流。
- **团队共享资源**：工具 / 技能 / 工作流是**独立资源库**，不绑定在单个 Agent 上，可被任意 Team / Agent 复用。

---

## 3. 命名（已与用户确认）

| 对象                           | 名称                                                     | 说明                                             |
| ------------------------------ | -------------------------------------------------------- | ------------------------------------------------ |
| 主侧栏一级菜单（平台共享市场） | **智能体市场**                                           | 路由 `/marketplace`，挂在侧栏「AI 实验场」那一区 |
| 个人中心新分组（私有公司后台） | **我的团队**                                             | `/me` 下与「API 与模型」同级的新分组             |
| 市场子货架                     | Agent 市场 · 技能市场 · 工具市场 · 工作流市场 · 团队市场 | 五个独立货架，全平台共享                         |
| 个人中心「API Keys」section    | **我的密钥**                                             | 中文标签由「API Keys」改为「我的密钥」           |

---

## 4. 信息架构

### 4.1 主侧边栏（平台共享）

在「AI 实验场」分区，于「AI 实验场」下方新增一条一级入口：

```
AI 实验场区
  ├─ AI 实验场      /agent-playground（现有）
  └─ 智能体市场     /marketplace（新增）
```

**智能体市场 `/marketplace`**：顶部 Hero +「Agent · 技能 · 工具 · 工作流」四个货架 Tab。

- 每个货架：搜索 + 分类筛选 + 卡片货架 + 详情抽屉 +「加入我的团队」。
- 全平台共享：所有董事长逛同一套货架（平台策展目录；UGC 发布留作后期）。
- 工具货架标注「来自 MCP / OpenAPI」徽章，呼应生态对接能力。

### 4.2 个人中心 `/me`（用户私有）

**重构前：**

```
个人          账户 · 通用
API 与模型     API Keys · 我的模型 · 我的工具 · 我的技能 · 我的 Agent
资源与计费     集成 · 通知 · 账单
```

问题：「API 与模型」混入了工具/技能/Agent，主题不纯。

**重构后：**

```
个人          账户 · 通用
API 与模型     我的密钥 · 我的模型                          ← API Keys 中文改为「我的密钥」；收纯，只剩密钥和模型
我的团队 ★新分组（与「API 与模型」同级）
   ├─ Agent 团队    管理团队(CEO+各Leader) + 各 Agent Team 组建/成员/任命 + 下任务/实时执行
   ├─ 团队工具      独立工具库，从「工具市场」获取，可分配给任意 Team/Agent   ← 原"我的工具"移入改名
   ├─ 团队技能      独立技能库，从「技能市场」获取，可分配                    ← 原"我的技能"移入改名
   └─ 团队工作流    独立 SOP 库，从「工作流市场」获取，Team 可套用            ← 新增
资源与计费     集成 · 通知 · 账单
```

**三个动作：**

1. 新建分组「我的团队」（group 级，与 API与模型 平级）。
2. 把工具、技能两个 section 从「API 与模型」整体移入「我的团队」，改名「团队工具 / 团队技能」。
3. 把「我的 Agent」section 改名「Agent 团队」，内容替换为全新的一人公司 OS。
4. 新增「团队工作流」section。

> **断链防护**：主侧栏「我的 Agent」分区有「管理/查看全部」链接指向 `/me/agents`。重构需保留 `/me/agents` 可达（落到「Agent 团队」的人才库视图）。

### 4.3 共享 vs 私有的对称（IA 骨架）

| 智能体市场（平台共享，去采购） | →   | 我的团队（私有，已获取 + 编排）                           |
| ------------------------------ | --- | --------------------------------------------------------- |
| Agent 市场                     | →   | **Agent 团队**（招来的 Agent 编进 Team）                  |
| 工具市场                       | →   | **团队工具**                                              |
| 技能市场                       | →   | **团队技能**                                              |
| 工作流市场                     | →   | **团队工作流**                                            |
| 团队市场                       | →   | **我的团队**（整支套用：花名册+Leader+workflow 开箱即用） |

> ★ 2026-06-08（用户拍板）：**团队市场**升为第 5 货架。与工作流市场的区别——工作流市场卖
> 的是"阵型 + SOP 配方"（你自带 agent）；团队市场卖的是**一支已配好的完整组织**（具体花名册
>
> - Leader + 绑定 workflow + 工具/技能装配），开箱即跑,是组合层级（tool ⊂ skill ⊂ agent ⊂
>   workflow ⊂ team）顶端、信息密度与价值最高的交钥匙单元。`CapabilityKind` 已含 `team`。

一句话：左边逛商场（共享），右边是公司后台（私有），资源跟着团队走。

---

## 5. 各区域内容明细

### 5.1 智能体市场（5 货架）

| 货架       | 一个 SKU =                                                 | 卡片要素                                | 详情抽屉                                       |
| ---------- | ---------------------------------------------------------- | --------------------------------------- | ---------------------------------------------- |
| Agent 市场 | 一份 Agent 蓝图（`IAgentIdentity`）                        | 头像/职位/擅长/资历/自带技能+工具       | 简介 + 能力标签 + 默认模型 +「招聘到我的团队」 |
| 技能市场   | 一个 `SKILL.md` 指令包                                     | 名称/简介/适用角色/标签                 | 指令预览 +「加入团队技能」                     |
| 工具市场   | 一个 `ITool`                                               | 名称/类别/来源(内置/MCP/OpenAPI)/副作用 | 入参出参 +「加入团队工具」                     |
| 工作流市场 | 一套阵型+pipeline（`TeamConfig`+workflow）                 | 名称/团队规模/角色/阶段数               | 阶段图 +「套用为新 Team」                      |
| 团队市场   | 一支配好的完整团队（花名册+Leader+workflow+工具/技能装配） | 团队名/规模/角色构成/绑定工作流         | 组织全貌 +「套用为我的团队」                   |

### 5.2 Agent 团队（核心 OS，section 内部分页）

```
Agent 团队
 ├─ 驾驶舱        管理团队总览(CEO+各Leader卡) + 各 Team 在忙啥 + 待审批 + 算力开销
 ├─ 组队工作台    左:人才库 + 「去市场招人」；中:阵型画布(拖入成员/点⭐设 Leader)；右:装配(配工具/技能/工作流)
 ├─ 人才库        我已招募的 Agent（吸收原"我的 Agent"管理能力，不丢功能）
 ├─ 任命 CEO      从已招 Agent 选一个职业经理人当 CEO
 └─ 任务 + 实时执行 给 Leader/CEO 下任务 → 协作流可视化（复用 MissionFlowView 风格）
```

### 5.3 团队工具 / 团队技能 / 团队工作流

- 独立资源库，列出"我已从市场获取"的条目。
- 支持分配：把某工具/技能挂到某 Agent，把某工作流套到某 Team。
- 与市场的关系：市场=获取入口，这里=已拥有 + 分配。

---

## 6. 后端映射（复用 vs 新增）

> 依据对 `ai-harness` / `ai-engine` / `playground` 四路源码探索。

| 能力                                         | 复用现有                                                                           | 需新增                               |
| -------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------ |
| Agent 定义（角色/人设/技能白名单/工具/约束） | ✅ `IAgentIdentity` + `@DefineAgent`，45+ 预定义 Agent                             | 市场化「上架/采用」数据层            |
| 技能体系                                     | ✅ `BuiltinSkillCatalog` + `ISkillProvider`（已支持 db 来源）                      | 技能市场目录 + 团队技能库            |
| 工具体系                                     | ✅ `ToolRegistry`（7 类）+ MCP/OpenAPI/function 适配器                             | 工具市场目录 + 团队工具库            |
| Team + Leader                                | ✅ `TeamConfig`(含 `leaderRoleId`) + `Leader` 类（真 LLM 驱动拆解/分派/评审/整合） | 用户私有 Team 持久化                 |
| 任务执行循环                                 | ✅ `LeaderWorkerLoop` 五元环 + `DAGExecutor` + `KernelScheduler`                   | 泛化出研究报告之外的通用 mission     |
| 实时进度                                     | ✅ 47+ WebSocket 事件 + crash 恢复                                                 | 通用化事件 schema                    |
| 协作模式                                     | ✅ 辩论/投票/评审/Handoff 均真实现                                                 | —                                    |
| CEO / 管理团队 / 多 Team 协同                | ❌（Handoff + AgentRegistry 是基础）                                               | Campaign / Team-to-Team 协议（后期） |
| 工作流市场                                   | ✅ workflow 定义结构存在                                                           | 工作流目录 + 套用为 Team             |

**三个净新增（net-new）：**

1. 市场层（marketplace）：现在技能/工具/Agent 都是代码里注册的 registry，不是用户可浏览/采用的市场。
2. 跨 Team 协同协议（CEO + 管理团队的编排）。
3. 组织层 + 全新前端 UI（市场 / 我的团队）。

---

## 7. 分期里程碑（强成功标准）

> ⚠️ **已被英雄模型取代**：实际交付以 [opc-hero-model.md](../../architecture/opc-hero-model.md) 的"英雄三期"为准（后端 CompanyHero + heroes CRUD + 派单走 capability → 前端我的英雄页 + 英雄市场货架 → 默认英雄 + 隐藏旧 Tab）。下表 M0–M3（尤其 M3「CEO + 多 Team Campaign」）降级为进阶路愿景，非当前里程碑。

| 里程碑         | 内容                                                                | 验证标准                                                                                                                                       |
| -------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **M0（当前）** | 纯前端可点击原型：智能体市场 + 我的团队 IA，mock 数据，页面间可跳转 | 可点完整路径：市场招 3 个 Agent → 我的团队组队 → 任命 Leader → 下任务 → 看 mock 执行流；`type-check` 0 error；`audit:ui-discipline` 基线不上涨 |
| **M1**         | 市场数据层 + 共享货架接后端真数据                                   | 五货架读真实 Agent/技能/工具/工作流/团队目录                                                                                                   |
| **M2**         | 用户私有 Team 持久化 + 单 Team 任务真跑通（接 `LeaderWorkerLoop`）  | 一个真实 Team 能跑完一个任务并出结果                                                                                                           |
| **M3**         | CEO + 管理团队 + 多 Team 协同（Campaign 协议）                      | 一个跨 Team 战役自动拆解、分派、汇总                                                                                                           |

**M0 之前不写任何后端、不接真实数据。** 市场只读货架，「加入我的团队」在原型里只更新前端 mock 状态。

---

## 8. M0 原型范围与文件清单

### 8.1 新建（互不污染现有文件）

```
frontend/app/marketplace/page.tsx                  ← 市场路由
frontend/components/marketplace/
  MarketplaceView.tsx        市场外壳 + 5 货架 Tab
  ShelfGrid.tsx              通用货架（卡片 + 搜索 + 筛选）
  ListingCard.tsx            货架卡（4 类通用）
  ListingDetailDrawer.tsx    详情抽屉
  marketplace.types.ts / marketplace.mock.ts
frontend/components/me/team/                        （"我的团队"分组的内容）
  AgentTeamSection.tsx       Agent 团队 OS（内部分页：驾驶舱/组队/人才库/任命CEO/任务）
  TeamToolsSection.tsx       团队工具
  TeamSkillsSection.tsx      团队技能
  TeamWorkflowsSection.tsx   团队工作流
  views/ ...                 各内部视图
  team.types.ts / team.mock.ts
frontend/stores/company/companyStore.ts            ← 跨路由共享"我的团队"状态（in-memory）
```

### 8.2 改现有（最小侵入，仅接线）

1. `components/me/settings-sections.tsx` — 新增「我的团队」分组 + 4 个 section；工具/技能改 group 归属与 labelKey。
2. `app/me/layout.tsx` — 分组渲染已是数据驱动，通常无需改（确认即可）。
3. `lib/i18n/locales/zh.json` + `en.json` — 新增导航 key（`me.nav.groupTeam` / `agentTeam` / `teamTools` / `teamSkills` / `teamWorkflows` / `nav.marketplace` 等）；并把 `me.nav.apiKeys` 的中文值由「API Keys」改为「我的密钥」。
4. `lib/design/module-themes.ts` — 已加 `market` / `company`（识别色：市场=翡翠绿、团队=灰蓝）。
5. `components/layout/Sidebar.tsx` — 「AI 实验场」区新增「智能体市场」入口。
6. 保留 `/me/agents` 可达（落到 Agent 团队人才库）。

### 8.3 M0 明确不做

- 不接后端 / 不持久化（刷新重置）/ 不真实跑 LLM。
- 多 Team 协同只放占位卡。
- 团队工具/技能 M0 先沿用现有管理 UI 的"已获取列表"形态，新增"分配给 Team"为占位。

---

## 9. 决策记录

1. **Agent 团队 section 内部布局**：全部视图收在 Agent 团队 section 内部分页（驾驶舱/组队/人才库/任命CEO/任务），不拆独立 section。具体布局（顶部组织图+内部 Tab vs 左子导航）见 §9.1，待用户从示意中选定。
2. **团队工具/团队技能**：✅ **移入并改名现有的工具/技能管理 UI**（保留功能、低风险）。团队工作流为全新 section。
3. **管理团队可视化**：✅ **放**——驾驶舱顶部呈现"董事长 → CEO → 各 Leader"组织图。
4. **团队工作领域不设限**：✅ 团队能干的具体工作取决于一人公司定位，不限制。M0 市场 mock 数据覆盖多领域 Agent（市场/运营/财务/法务/研发/设计/客服等）以体现通用性。
5. 市场经济性质（平台策展 / UGC 发布 / 双边交易）后期再定，M0 按"平台策展只读"。

### 9.1 Agent 团队 section 内部布局：✅ 选定方案 A

**顶部管理团队组织图（横幅）+ 内部胶囊 Tab 切换**，与 `/me` 已有的左设置导航不嵌套，内容区更宽。

```
┌─ Agent 团队 ──────────────────────────────┐
│  管理团队（虚拟）                          │
│        董事长(你)                          │
│           │                               │
│        [CEO·墨菲]                          │
│         ╱      ╲                          │
│  [Leader·陆] [Leader·安]                   │
├───────────────────────────────────────────┤
│ ◉驾驶舱  组队  人才库  任命CEO  任务        │ ← 内部 Tab
├───────────────────────────────────────────┤
│  Team A ▸ 写季度复盘   ▓▓▓▓░ 80%           │
│  Team B ▸ 调研竞品     ▓▓░░░ 40%           │
│  待审批 2 · 本月算力 ¥128                  │
└───────────────────────────────────────────┘
```

至此本设计方案的所有开放问题均已闭合，可进入 M0 实现。

---

## 10. 后端实现架构（2026-06-07 与用户确认）

**新模块** `backend/src/modules/ai-app/company/`（一人公司 OS）。分层：`api/controller`(REST+WS) · `api/dto`(class-validator) · `services/*`(业务+repository) · `runtime`(接 ai-harness 执行)。facade-only 访问 engine/harness；JwtAuthGuard + RequestWithUser；手写幂等迁移。

**市场目录 = 现有 registry 的只读投影**（不建目录表）：

- Agent → `ai-app/contracts/agent-catalog.ts` `PLATFORM_AGENT_METAS`（8 真实 Agent）+ `SpecAgentRegistry`
- 技能 → `SkillRegistry` / 内置 skill catalog
- 工具 → `ToolRegistry.getEnabled()`（~70 真实工具）
- 工作流 → `TeamRegistry.getAllConfigs()`（真实 TeamConfig + workflow steps）

**Prisma 新模型**（均按 userId 私有，手写迁移）：`CompanyProfile`(ceo+名) · `CompanyTeam` · `CompanyHiredAgent`(models[]/autoFallback/skillIds/toolIds) · `CompanyWorkflow`(origin/stages…) · `CompanyMission`。

**Mission 执行**复用 ai-harness `LeaderWorkerLoop`/runner + WebSocket（照搬 playground），不新造 runner。

### 分三波交付（每波推 main）

- **W1 市场真数据**：W1a 后端目录 API（投影 registry）→ W1b 前端市场接真数据 + 前端 catalog store 取代 marketplace.mock，companyStore 种子改空。
- **W2 持久化**：Prisma 模型+迁移 + 公司/团队/招募/工作流 CRUD API + 前端「我的团队」接真数据（替换 companyStore in-memory）。
- **W3 执行**：团队 Mission 接 ai-harness runner + WebSocket 实时流。

### W1 后端目录 DTO 契约（语义层，UI 字段由前端适配）

- `AgentCatalogItem`: id,name,description,role,category,tags[],capabilities[],skillIds[],toolIds[],defaultModel
- `SkillCatalogItem`: id,name,description,category,tags[],activatesFor[]
- `ToolCatalogItem`: id,name,description,category,tags[],source(builtin|mcp|openapi)
- `WorkflowCatalogItem`: id,name,description,category,teamSize,roles[],stages[]

---

## 附录：相关源码锚点（探索结论）

- Agent 定义：`backend/src/modules/ai-harness/agents/abstractions/identity.interface.ts`、`dev-tools/agent-spec.base.ts`
- 技能：`ai-harness/agents/skill-runtime/skill-registry.ts`（`ISkillProvider` 支持 db 来源）
- 工具 + MCP：`ai-engine/tools/registry/tool.registry.ts`、`ai-engine/tools/adapters/mcp/`
- Team + Leader：`ai-harness/teams/abstractions/team.interface.ts`、`teams/base/member.ts`、`teams/base/leader-llm-adapter.ts`
- 执行循环：`ai-harness/runner/loop/`（LeaderWorkerLoop）、`runner/dag/`、`runner/scheduler/`
- Mission 全链路 + 事件：`ai-app/playground/`（14-stage pipeline、47+ 事件、crash 恢复）
- 前端复用：`components/ui/`（Modal/EmptyState/Tabs/PageHeaderHero/Button/StatusBadge）、`components/common/mission-detail/`、`components/common/team-topology/`、`components/agent-playground/flow/MissionFlowView.tsx`
