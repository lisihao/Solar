# Agent Teams 呈现标准化迁移 — 设计基线（Design Baseline）

**状态：** ✅ 评审通过 v0.5（四路两轮 4/4 共识，2026-05-21）；进 P0 受门禁约束（先修 BLK-7 gateway JWT）
**强制级别：** 评审通过后转 MUST（落实标准 21 的 P3）
**日期：** 2026-05-21
**作者：** Claude Code
**关联：** [标准 21 Agent Teams 呈现](../../../.claude/standards/21-agent-teams-presentation.md)（本设计 = 其 §7 P3 的 ai-teams 落地）· [ADR-007](../../decisions/007-ai-teams-presentation-migration.md) · 模板源 `agent-playground`
**评审基线版本：** v0.5（四路两轮评审达成 4/4 共识；见[评审纪要](../2026-05-21-design-review-minutes.md) §6）

> 一句话目标：把 `ai-teams` 的详情/执行页从 **3153 行自写 god-class** 迁到 **agent-playground 同款 canonical 呈现**（左：团队拓扑+角色卡+进度；右：任务列表/动作/报告 Tab），组件全复用，ai-teams 只贡献「阶段 step-map + 产出渲染器」。

---

## 1. 背景

- 标准 21 已钦定：agent 团队跑 mission 类功能**统一用 agent-playground 范式**（事件流 → 纯函数派生 → 只读组件渲染）。`ai-teams` 在标准 21 §5/§7 明列为 🔴 **待迁移（P3）**。
- 用户诉求：Agent Teams 后端（Harness+Engine+Infra）已实现，但**前端呈现没标准化**；要做到 Screenshot_100 那种 playground 式呈现。

## 2. 现状盘点

| 项             | 现状                                                                             |
| -------------- | -------------------------------------------------------------------------------- |
| 详情页         | `app/ai-teams/[topicId]/page.tsx` **3153 行 god-class**，自写进度/事件/面板/状态 |
| 列表页         | 已用 `PageHeaderHero` + `AssetCard`（标准 21 列表层基本对齐）                    |
| 实时通道       | 后端 `ai-teams.gateway.ts`（Socket.IO，已 polling-first 抗代理）；前端自写消费   |
| 派生层         | ❌ 无纯函数派生（逻辑散在组件/effect）                                           |
| canonical 框架 | ❌ 未用 `common/mission-detail/`、`StageStepper`、`useMissionStream`             |

## 3. 目标态架构（标准 21 §3 详情层）

```
ai-teams mission 事件（WS + replay 水合 + 轮询兜底）
        │  useMissionStream（由 useAgentPlaygroundStream 泛化；P1 of 标准21）
        ▼  events: MissionEvent[]
deriveTeamsView(events)   纯函数（lib/features/ai-teams/）→ { mission, stages, agents, todos, cost, artifacts }
        │  幂等可重放 + fixture 回归测试
        ▼  只读 view-model
components/common/mission-detail/  MissionDetailFrame + StageStepper + MissionActionGroup
        │  + 团队拓扑（common/team-topology）+ 右侧 Tab（任务列表/动作记录/输出报告/参考/消息）
        ▼
   TeamsArtifactRenderer（辩论/共识/报告产出，挂 ArtifactReader 插槽）
```

**ai-teams 只需贡献三样**（业务适配，标准 21 §3 + 本次评审补充）：

1. **step-map**：声明 ai-teams mission 的阶段拓扑（参考 `lib/features/ai-social/derive-social-stages.ts`）。
2. **tab 选择 + 数据适配**：业务决定**展示哪些 tab**（如 ai-teams 要任务列表+动作+报告+消息，ai-radar 可能只要信号+报告）+ 提供每个 tab 的数据适配（从 view-model 取数）。
3. **artifact renderer**：团队辩论/共识/报告的产出展示组件，挂 ArtifactReader 插槽。

其余（拓扑、角色卡、阶段进度、事件流、todo 板、引用、算力、实时通道、派生引擎、**以及每个 tab 的统一呈现**）**全部复用，不得各造**。

**左栏布局（BLK-10，角色卡落点）**：团队拓扑（`common/team-topology` canvas）→ 其下**角色卡列表**（复用 `team-topology/avatars/` 现有 leader/researcher/reviewer/writer 等 10 个角色卡组件），数据取 `view.agents`，点击角色卡展开该 agent 的子任务/产出/状态 → 进度条（`StageStepper`）→ 操作（`MissionActionGroup`：开启/更新/取消/重试）。即 Screenshot_100 左栏逐元素都有 canonical 落点。

### 3.5 标准化 Tab 体系（评审重点：业务定"展示哪些"，平台定"每个怎么呈现"）

> 现状缺口：`common/mission-detail/` 只有 Frame/Stepper/ActionGroup，**没有 canonical tab 组件**——playground 自己拼了任务表/算力面板。要落实「每个 tab 统一规范、最大化复用」，需把 tab 抽成 canonical。

**契约**：详情页右侧是一个 `MissionTabs` 容器，吃一份**业务给的 tab 配置**：

```
type MissionTab = {
  key: string;                 // 'tasks' | 'actions' | 'report' | 'references' | 'messages' | ...
  label: string;               // 业务命名
  render: (view) => ReactNode; // 复用 canonical tab 组件 + 业务数据适配
};
// 业务（ai-teams）只声明 tabs: MissionTab[]，决定展示哪些、顺序、命名
```

**canonical tab 组件（抽到 `common/mission-detail/tabs/`，全特性复用）**：

| tab      | canonical 组件         | 数据来自                  | 复用现有                                    |
| -------- | ---------------------- | ------------------------- | ------------------------------------------- |
| 任务列表 | `MissionTaskListTab`   | `view.todos`              | 抽自 playground `MissionTodoBoard`/任务表   |
| 动作记录 | `MissionActionLogTab`  | `view.events`（派生动作） | 抽自 playground 动作流                      |
| 输出报告 | `MissionReportTab`     | `view.artifacts`          | 复用 `report-viewer` / ArtifactReader       |
| 参考文献 | `MissionReferencesTab` | `view.references`         | 复用 `common/citations`（CitationListItem） |
| 我方消息 | `MissionMessagesTab`   | `view.messages`           | 复用消息卡 `MessageCardShell`               |
| 算力     | `MissionComputeTab`    | `view.cost`               | 抽自 playground `ComputeUsagePanel`         |

> 即：**业务决定 tab 选择与数据适配（差异化），平台统一每个 tab 的呈现规则与组件（标准化）**——与标准 22 卡片体系同思路。表格走 `ui/table`/`DataTable`、卡片走 canonical、不自写。
>
> **P1.5 收窄（YAGNI，纪要 §2）**：上表 6 个 canonical tab **先只抽有明确复用源的前 3**（TaskList→DataTable / Report→report-viewer / References→citations）；ActionLog / Messages / Compute 待第二消费方出现再抽。`MissionTab` 契约收紧为 `{ key, label, component: CanonicalTabKey, adapt: (view)=>TabProps }`（业务只能**选** canonical + 数据适配，不能传任意 ReactNode）。

## 4. 关键设计：事件模型映射（最核心、最需评审）

迁移成败在于把 **ai-teams 后端现有事件**映射到 `MissionEvent` + `deriveTeamsView` 能消费的形状。

| 待评审点        | 说明                                                                                                            |
| --------------- | --------------------------------------------------------------------------------------------------------------- |
| ai-teams 事件源 | 现 `ai-teams.gateway` emit 哪些事件？字段？需先盘点（P0 调研），与 `MissionEvent` 对齐或加 adapter              |
| namespace       | 复用 derive 的 namespace 机制（`derive.ts` 已规范化 `social.*/agent-playground.*/ai-radar.*`，加 `ai-teams.*`） |
| 历史水合        | 详情页进入时 replay 历史事件（DB 快照兜底），与 playground 一致                                                 |
| stages 拓扑     | ai-teams 的「Leader 拆解 → 多 Researcher 并行 → Reviewer → Writer」阶段，落 step-map                            |

> ⚠️ 若 ai-teams 后端事件与 `MissionEvent` 差异大，P1 需要一层 **events adapter**，把后端事件规范化后再喂 deriveTeamsView——这是工作量的关键不确定项，**P0 调研先定**。

### 4.1 P0 调研结论（2026-05-21，✅ 完成）

**核心发现：ai-teams 事件与 agent-playground 事件族不匹配，adapter 强制必需**（直接喂 `deriveView` → mission/stages/agents/cost 全空）。

ai-teams 实际 emit ~24 个事件（gateway + mission/tool/ai 服务），与 playground derive 期待的映射：

| playground 事件（derive 消费）   | ai-teams 对应                                                    | 完成度 | 处置                                         |
| -------------------------------- | ---------------------------------------------------------------- | ------ | -------------------------------------------- |
| `mission:started`                | `mission:created`（缺 input 字段）                               | 70%    | adapter 补字段                               |
| `stage:lifecycle`                | `mission:agent_working`(心跳)+`mission:agent_done`+`task:status` | 40%    | adapter 聚合 task→stage                      |
| `agent:lifecycle/thought/action` | `ai:typing/response/error`                                       | 50%    | adapter 转换                                 |
| `agent:action/observation`       | `tool:calling/result/complete`（3 阶段）                         | 60%    | adapter 3→2 阶段                             |
| `cost:tick`                      | **无**                                                           | 0%     | ⚠️ 决策：后端补 emit 或 Teams 略 Compute tab |
| `dimension:*/chapter:*`          | **无**（ai-teams 是 task 模型非 research pipeline）              | —      | 不适用，Teams step-map 用 task 拓扑          |

**结论 + 工作量**：

- **必做**：`lib/features/ai-teams/adapt-events.ts`（命名空间包装 + mission/task/tool/ai 事件转换）≈ **580 行（含测试）≈ 2-3 天**。这是原设计未充分估计的工作量，纳入 P2。
- **决策点（需用户/评审定）**：`cost:tick` 与 pipeline 在 ai-teams **无数据源** → (a) 后端补 emit `cost:tick`（~200 行，长期更干净）；或 (b) Teams 详情页**不展示算力 tab**（前端零成本，本期推荐）。建议 **(b) 本期略 Compute tab**，后端标准化列为后续。
- deriveTeamsView **不复用** playground 的 dimension/chapter 派生（research 专属）；只取通用 mission/stages/agents/todos + 一个 ai-teams **task→stage step-map**。
- god-class 功能映射清单已产出（~23 项功能 → page.tsx 行号，见调研记录），作为 P3「一次性切换不丢功能」的逐项验收底稿。

## 5. 组件复用清单（标准 21 §8）

| 层         | 复用文件                                                                           |
| ---------- | ---------------------------------------------------------------------------------- |
| 实时       | `hooks/features/useAgentPlaygroundStream.ts` →（P1 泛化）`useMissionStream`        |
| 纯派生参考 | `lib/features/agent-playground/derive.ts` · `todo-ledger.ts`                       |
| 共享框架   | `components/common/mission-detail/`（Frame/StageStepper/MissionActionGroup/Shell） |
| 拓扑       | `components/common/team-topology/`                                                 |
| 列表层     | 已用（`PageHeaderHero`/`AssetCard`/`MissionGalleryView`）                          |

## 6. 拆 god-class（3153 行 → 薄页 + 派生 + 复用组件）

- `page.tsx` 降为 < 100 行（路由+取参+渲染 `components/ai-teams/AiTeamsMissionPage.tsx`）。
- 业务逻辑 → `lib/features/ai-teams/`（deriveTeamsView + step-map + events adapter，纯函数 + 测试）。
- UI → 复用 `common/mission-detail/` + ai-teams 专属 artifact renderer。
- 现有 god-class 的功能逐块映射到上述，**不丢功能**（取消任务/重试/分享等 → MissionActionGroup）。

## 7. 分阶段交付 + 验收标准

| 阶段                       | 内容                                                                                                                                  | 验收                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **P0 调研**（先做）        | 盘点 ai-teams 后端事件模型 + 与 MissionEvent 差异 → 定 adapter 方案                                                                   | 产出事件映射表，更新本设计 §4                                                             |
| **P1 派生引擎泛化**        | `useAgentPlaygroundStream`→`useMissionStream`；通用 derive 提 `lib/missions/`（与标准 21 P1 协同）                                    | playground 回归不破；新 hook 有测试                                                       |
| **P1.5 抽 canonical tabs** | 把 playground 的任务表/动作/算力等抽到 `common/mission-detail/tabs/` + `MissionTabs` 容器 + tab 契约（§3.5），playground 先迁过去验证 | playground 用新 canonical tabs 无回归；每个 tab 复用 DataTable/citations/MessageCardShell |
| **P2 ai-teams 派生层**     | `lib/features/ai-teams/`：events adapter + deriveTeamsView + step-map + **fixture 回归测试**                                          | 纯函数测试：生产事件快照 → 期望 view-model                                                |
| **P3 详情页迁移**          | 新 `AiTeamsMissionPage` 用 mission-detail Frame + 拓扑 + Tab；page.tsx 瘦身                                                           | 真机：跑一个 team mission，呈现 = playground；旧功能不丢                                  |
| **P4 旧 god-class 下线**   | 删 3153 行旧详情，import 全切                                                                                                         | 无残留引用；audit/lint/tsc 0                                                              |

> 与 #1（对话整理）的顺序：用户已定 **#1 先做**；本迁移在 #1 后启动，P0 调研可并行准备。

### 7.1 落地进度（backfill）

| 波次                              | 状态 | commit / 说明                                                                                               |
| --------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------- |
| BLK-7 gateway JWT 校验（P0 前置） | ✅   | `20e9d0e31`（gateway 改 JWT verify + module 加 JwtModule + spec 46 绿）                                     |
| P0 事件调研 + god-class 功能映射  | ✅   | 见 §4.1：adapter 强制必需（~580 行）+ cost/dimension 无源（决策：本期略 Compute tab）+ 23 项功能映射底稿    |
| P1 泛化 useMissionStream          | ✅   | `698d98d0a`：useMissionStream 参数化 namespace/replay/join/leave/idKey/acceptEvent；playground 回归 105/105 |
| P1.5 抽 3 canonical tabs          | ⏳   | TaskList/Report/References                                                                                  |
| P2 deriveTeamsView + adapt-events | ⏳   | task→stage step-map + adapter（§4.1）+ fixture 回归                                                         |
| P3 详情页迁移（一次性切换）       | ⏳   | 逐项对照功能映射底稿                                                                                        |
| P4 删旧 god-class                 | ⏳   | grep 0 引用                                                                                                 |

> P0 已清门禁。**下一波 P1**（泛化 `useMissionStream`）可开。提交注意：当前机器多 session 并发，lint-staged 易 OOM 崩溃 → 用 `NODE_OPTIONS='--max-old-space-size=6144' git commit/push`（见 memory，勿杀 node 进程）。

## 8. 架构铁律（标准 21 §4，迁移必须遵守）

- 事件→视图必须纯函数派生，幂等可重放，**带 fixture 回归测试**。
- 实时统一 `useMissionStream`，不自写轮询。
- 状态来源 = 原始 events[]（+DB 快照）→ useMemo 派生 → 组件只读。
- 不 fork `StageStepper` / 不复制 `common/mission-detail/`。

## 9. 风险与缓解

| 风险                                | 缓解                                                  |
| ----------------------------------- | ----------------------------------------------------- |
| ai-teams 事件与 MissionEvent 差异大 | P0 调研先定 adapter；差异表进设计再开工 P2            |
| 3153 行 god-class 拆解遗漏功能      | 逐功能映射清单（取消/重试/分享/加入/编辑…）→ 对照验收 |
| 与并发会话/本轮 UI 治理冲突         | 迁移期避开他人正动文件；分波小步 commit               |
| 大重构回归                          | 派生层 fixture 回归 + 真机跑通才下线旧页              |

## 10. 评审清单 / 待确认

- [ ] P0 事件调研结论（最关键）：ai-teams 后端事件是否够喂 deriveTeamsView？adapter 工作量？
- [ ] artifact：team mission 的核心产出是什么（辩论记录 / 共识报告 / 最终报告）？渲染器范围？
- [ ] 是否与标准 21 P1（泛化 useMissionStream）合并做，还是 ai-teams 内先局部用 useAgentPlaygroundStream？
- [ ] 旧 god-class 下线节奏（灰度并存 vs 一次切换）。

```

```
