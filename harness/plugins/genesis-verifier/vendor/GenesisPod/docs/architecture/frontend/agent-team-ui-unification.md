# 统一 AI Agent Teams UI — 设计基线（Design Baseline）

**状态：** ✅ v1.0 锁定（四路 4× 批准 + 用户拍板，2026-05-21）；**W0 改走 B 路（用户 2026-05-21 定）：playground 零改（活标杆），反向把其外壳原样抽成 canonical（== playground），其余 feature 用抽出来的壳 → 自动一致**。理由：「整体体验和现在 playground 一模一样」下，不碰 playground 是最稳的（迁它反而可能引入差异）。
**评审纪要：** [agent-team-ui-unification-review.md](agent-team-ui-unification-review.md)
**强制级别：** 评审通过后转 MUST（落实并扩展[标准 21](../../../.claude/standards/21-agent-teams-presentation.md)）
**日期：** 2026-05-21
**作者：** Claude Code
**关联：** [标准 21 Agent Teams 呈现](../../../.claude/standards/21-agent-teams-presentation.md) · [标准 22 前端 UI 治理](../../../.claude/standards/22-frontend-ui-component-governance.md) · [ADR-008](../../decisions/008-agent-team-ui-unification.md) · 模板源 `agent-playground`
**评审基线版本：** v0.2（四路评审后迭代；纪要见上。关键订正：playground 未用 Frame、W0 先迁它、DrawerShell 补 header slot、范围补 topic-insights/ai-office、audit 细则）

> 一句话目标：平台里所有「agent 团队跑 mission」类 ai-app（research / insights / radar / social / simulation / planning / writing / teams / playground …）的详情/执行页，**用同一套 canonical 壳**呈现——**业务定内容（自己的团队、自己的 tabs、tab 内容、抽屉内容），平台定风格（壳统一）**，做到全平台视觉/结构一致。
>
> **成功标准（用户 2026-05-21 强化）：每个迁移后的 feature「整体体验与目前 playground 完全一致」**——不是"相似 / 同风格"，是同一套壳跑出**一致的交互与视觉**（左团队 / 右 tab / 抽屉 / 进度 / 操作 / 流式）。W0 迁 playground 自身必须**体验零变化**（Frame 仅换外壳、逻辑 0 改）；后续每 feature 验收含「与 playground 体验对齐」截图 + 交互核验，作为**硬验收**（与 audit 结构闸并列，非可选）。

---

## 1. 背景与问题

- 平台约 10 个菜单本质是同一种东西：**一个 agent 团队跑多阶段 mission → 流式展示进度 → 产出报告/产物**。但历史上每个 feature 各自造了详情页（头部、左栏团队、右栏 tab、抽屉、进度条、事件流各写一套），**视觉与结构不一致**。
- 标准 21 已立「以 agent-playground 为唯一呈现模板」的 ADR，但只完成了 playground（模板源）+ ai-social（基本对齐）+ ai-radar（半程），其余 feature 仍是 bespoke。
- 用户诉求（2026-05-21 澄清并确认）：**所有 AI App 都是 agent team，应参考 playground 形成 UI 一致性**；左侧团队显示成什么、右侧 tab 显示成什么、tab 点开的抽屉是什么——**内容业务自定义，风格平台统一**。

## 2. 核心原则：业务定内容，平台定风格

| 区域        | 业务自定义（内容，各 feature 不同）        | 平台统一（风格/壳，canonical）                 |
| ----------- | ------------------------------------------ | ---------------------------------------------- |
| 头部        | 标题 / 状态 / 操作按钮                     | header 布局 + 品牌渐变 icon + status pill 风格 |
| 左栏        | 团队构成（Leader/成员/几个角色、什么角色） | 团队/角色卡展示风格、可折叠行为                |
| 右栏 tab 条 | 要哪些 tab、命名、顺序                     | tab 条样式 + 切换交互                          |
| tab 内容    | 自己的任务/报告/数据                       | 列表/表格/卡片/空态/加载态风格                 |
| 抽屉 Drawer | 抽屉里放什么（任务详情、agent 详情…）      | **抽屉壳风格**（宽度/动画/头部/关闭）          |
| 进度        | 自己的阶段拓扑                             | StageStepper 风格                              |
| 弹层 Modal  | 弹层里放什么                               | Modal 壳风格                                   |

> 即：feature 只提供 **数据 + slot 内容**；所有「怎么长」由 canonical 壳决定。新 feature 接入 = 填 slot，不碰样式。

## 3. Canonical 壳清单（一致性的载体）

| 壳                               | 路径                                             | 职责                                                                                      | 现状                                        |
| -------------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------- | ------------------------------------------- |
| `MissionDetailFrame`             | `components/common/mission-detail/`              | 整页外壳：header + 左团队 slot（可折叠）+ 右 tab 条 + 内容 slot + topBanner/trailing slot | ✅ 已存在                                   |
| `DrawerShell`                    | 同上                                             | 统一抽屉壳（任务/agent 详情等从内容区点开）                                               | ✅ 已存在                                   |
| `ModalShell`                     | 同上                                             | 统一弹层壳                                                                                | ✅ 已存在                                   |
| `StageStepper`                   | 同上                                             | 阶段进度条                                                                                | ✅ 已存在                                   |
| `MissionActionGroup`             | 同上                                             | 操作按钮组（开启/更新/取消/重试）                                                         | ✅ 已存在                                   |
| `team-topology` + 角色卡 avatars | `components/common/team-topology/`               | 团队拓扑图 + 10 个角色卡                                                                  | ✅ 已存在                                   |
| `useMissionStream`               | `hooks/features/`                                | 实时双通道（WS+replay+polling），参数化 namespace/replay/join/acceptEvent                 | ✅ 已泛化（`698d98d0a`）                    |
| canonical 内容 tab（可选）       | `components/common/mission-detail/tabs/`         | 常见内容类型复用件（References✅、TaskList/Report 待补）                                  | 🟡 起步（MissionReferencesTab `d3466a3b6`） |
| 纯派生层                         | `lib/features/{feature}/` + 通用 `lib/missions/` | events → view-model（feature 提供 deriveXxxView + step-map）                              | 各 feature 提供                             |

**结论：一致性的「壳」绝大部分已存在**。本工程主体 = **让所有 feature 采用这套壳**（adoption），+ 补齐少量缺口（canonical 内容 tab）+ 立 audit 防漂移。

## 4. Feature 接入契约（每个 feature 要做的）

```
1. 实时：useMissionStream({ namespace, replay, joinEvent, idKey, acceptEvent })
2. 派生：deriveXxxView(events) → { mission, stages, agents, todos, artifacts, references, ... }（纯函数 + fixture 测试）
3. 渲染：<MissionDetailFrame
     header.. statusPill.. headerActions={<MissionActionGroup .../>}
     leftPanel={<本业务团队/角色卡（用 team-topology 壳）/>}
     tabs={[本业务的 tab 配置]} activeTab onTabChange
   >
     {按 activeTab 渲染内容——可选用 canonical 内容 tab，或自渲染但用 canonical 原语（DataTable/EmptyState/卡片）}
   </MissionDetailFrame>
4. 抽屉/弹层：用 DrawerShell / ModalShell 包业务内容
```

> feature **不得**自写 header/tab 条/抽屉壳/进度条；只填 slot + 提供数据。

## 5. 现状盘点（adoption matrix）

> 评审订正（v0.2）：原矩阵高估了 adoption。**全前端 `MissionDetailFrame` 唯一真实消费者 = `ai-social`**；playground 自身是 1729 行 bespoke、未用 Frame；radar 是另一范式。实情如下：

| feature                                                             | 用 Frame                                                                      | stream hook                                              | 纯派生                                             | 状态                                         |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------- | -------------------------------------------------- | -------------------------------------------- |
| `agent-playground`                                                  | ❌ **未用**（1729 行 bespoke：自写 header/左栏/tab 条/抽屉/弹层）             | `useAgentPlaygroundStream`（=useMissionStream 薄封装）✅ | ✅（派生层是源）                                   | **派生/组件是源，但页面壳未对齐**；W0 先迁它 |
| `ai-social`                                                         | ✅（**唯一真实消费者** `SocialMissionPage`）                                  | `useSocialMissionStream`                                 | ✅（import playground derive → 待提 lib/missions） | 参考实现                                     |
| `ai-radar`                                                          | ❌ 另一范式（`SideDrawer`+`useRadarStream`+卡片/briefing，无 mission 详情页） | `useRadarStream`（独立）                                 | 部分                                               | 待确认目标形态（详情层 N/A？）               |
| `ai-insights` + `topic-insights`                                    | ❌（自造 Layout + 1403 行 store）                                             | ✗                                                        | ✗                                                  | 🔴 待迁（最重，富渲染降级 artifact 面板）    |
| `ai-research` `ai-planning` `ai-simulation` `ai-writing` `ai-teams` | ❌ bespoke 详情                                                               | ✗                                                        | ✗                                                  | 🔴 待迁                                      |
| `ai-office`                                                         | —                                                                             | —                                                        | —                                                  | 仅列表层 MUST，编辑器主体例外                |

> **裁决（评审 BLK-A，不再留 P0 待办）**：W0 第一张牌 = **把 playground 自身迁到 `MissionDetailFrame`**，作为真·参考实现 + 视觉基准（它已有全套 panel/drawer，按 §4 契约填 slot）。否则迁完的 feature 与"标杆 playground"两套视觉，一致性反而割裂。覆盖范围 = 标准 21 §2 全表。

## 6. 迁移计划（地基先行，已用户拍板）

- **W0 地基（大半已就位）**：`useMissionStream`✅ · Frame/Drawer/Modal/Stepper/topology✅ · canonical 内容 tab 起步✅。补口：playground 与 Frame 对齐复核；TaskList/Report canonical tab（按需）。
- **W1 立 audit 闸**：`audit:mission-detail-discipline`——扫「mission 类 ai-app 详情页是否用 canonical 壳」，出基线清单，纳入 pre-push（防新漂移 + 量化进度）。
- **W2+ 逐 feature 迁移**（顺序按"重/收益"，参考标准 21 §7）：ai-radar 半程收尾 → ai-research → ai-planning → ai-simulation → ai-writing → ai-teams → ai-insights（最重，富渲染降级为可插拔 artifact 面板）。每 feature：deriveView+step-map（带 fixture）→ 接 Frame slot → 旧详情下线（**真机跑通才删**）。

## 7. 一致性如何强制（防再次各写各的）

- **audit 闸**（仿标准 22 卡片治理）：检测 mission 类 feature 详情页里**自写 header 条 / tab 条 / 抽屉壳 / 进度条**的模式（如 `fixed inset-0` 抽屉、自写 `border-b ... tab` 条），出现即违规；canonical 壳放行。到 0 后焊死 HARD_ZERO。
- **component-placement 看护**：canonical 壳只在 `common/mission-detail/` 一处；feature 不得 fork。
- **标准 21 升级**：本设计通过后并入标准 21（从「ADR + 模板」升为「带 audit 强制的设计系统」）。

## 8. 分阶段交付 + 验收标准（强成功标准）

| 阶段           | 验收（可独立验证）                                                                                                                            |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| W0 地基复核    | playground 与 Frame 对齐结论；canonical 壳清单 + API 锁定；tsc 0                                                                              |
| W1 audit 闸    | `npm run audit:mission-detail` 跑出基线清单（N 个违规 feature）；纳入 pre-push                                                                |
| W2+ 每 feature | 该 feature 详情页 100% 用 canonical 壳（audit 该项归 0）；deriveXxxView 有 fixture 回归；旧页真机跑通后删；视觉与 playground 一致（截图比对） |
| 收官           | audit:mission-detail TOTAL=0 焊死；全 feature 详情页风格一致                                                                                  |

## 9. 风险与缓解

| 风险                                                            | 缓解                                                                                      |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| feature 富渲染能力（如 ai-insights 章节报告/批注/版本）迁移丢失 | 降级为挂 Frame content slot 的**可插拔 artifact 面板**（标准 21 ADR 已定），不丢 richness |
| Frame slot 不够灵活，业务塞不进                                 | W0 复核 Frame API；缺 slot 先补 Frame（不许 feature 绕过自写）                            |
| 大重构回归                                                      | 每 feature 派生层 fixture 回归 + 真机跑通才下线旧页（不盲删）                             |
| 多 session 并发改同文件                                         | 逐 feature 小步 commit，迁移期避让他人正动文件                                            |
| playground 自身与 Frame 不一致                                  | W0 先复核对齐，确保「模板源 = 壳」                                                        |

## 10. 评审清单 / 待确认

- [ ] §2 「业务定内容、平台定风格」分区表是否完整准确？
- [ ] §3 canonical 壳清单是否齐（有没有漏的壳，如算力/事件流面板）？
- [ ] W0 复核：playground 是否真用 Frame？若否，先对齐还是先立 audit？
- [ ] §6 迁移顺序是否合理（先易后难 vs 先高频）？
- [ ] §7 audit 强制的检测规则边界（哪些自写模式算违规）？
- [ ] ai-insights 的富渲染降级为 artifact 面板，能力是否真不丢？
