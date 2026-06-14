# 评审纪要 — 统一 AI Agent Teams UI 设计

**日期：** 2026-05-21
**形式：** 四路并行评审（架构 / 质量 / 产品 / 治理），各自核验源码后给结论。
**对象：** [agent-team-ui-unification.md](agent-team-ui-unification.md) v0.1 + [ADR-008](../../decisions/008-agent-team-ui-unification.md)
**基线：** v0.1 → 迭代至 **v0.2**

---

## 0. 四路结论：4× 🟡 批准但需改（无返工）

方向（业务定内容/平台定风格 = Frame slot + Drawer/Modal/Stepper 壳）**正确、不过度抽象、与标准 21/22 一脉相承，且 canonical 壳全部真实存在**。但有若干**事实性错误**（adoption 现状被高估）+ 一个**与用户意图冲突的真实漏洞**（抽屉头部/关闭未统一）+ audit 规则未落地，改完即可转 MUST。

---

## 1. 阻断项（必须改，v0.2 落实）

- **BLK-A【四路一致·根基】playground 未用 Frame。** 实测 `app/agent-playground/team/[missionId]/page.tsx` = **1729 行 bespoke**（自写 header 662-793 / 左栏 grid 798-919 / banner / tab 条 1015，0 处 import Frame/Drawer/Modal/Stepper）。**全前端 Frame 唯一消费者 = `ai-social/SocialMissionPage.tsx`**。「模板源 = 壳」不成立。→ **裁决（不留 P0 待办）**：W0 第一张牌 = **把 playground 自身迁到 Frame**（作为真·参考实现 + 视觉基准），它已有全套 panel/drawer，按契约填 slot；这是真实开发工作（非"复核"），需 fixture/截图回归。
- **BLK-B【架构+质量+治理】audit 规则未落地。** §7 只有意图。→ 补 §7.1 实现细则：扫 `app/ai-*/**` + `components/ai-*/**Page.tsx`；违规 pattern = ①自写 `fixed inset-0` 抽屉(绕 DrawerShell) ②自写 `border-b ... tab` 条(绕 Frame) ③自写 `<header ... justify-between border-b>` ④自写同构 StageStepper；**复用现有 `audit-ui-discipline.ts` 的 R6 三层豁免**（canonical 目录整体豁免 + import 豁免 + allowlist）；与标准 22 R6/R7 划清边界（22 管通用弹层，本 audit 管 mission 详情页结构）；**warn-only 出基线 → playground 迁完清零标杆 → 逐 feature 棘轮 → HARD_ZERO**（消除 §7「出现即违规」与 §8 warn-first 的措辞冲突）。
- **BLK-C【产品+质量·与意图冲突】DrawerShell 没统一头部/关闭。** `DrawerShell.tsx` 注释明写"关闭按钮(X)/ESC 由 children 自渲染"——各 feature 抽屉头部各写各的，**直接违背用户"抽屉风格也要一致"**。→ 给 DrawerShell 加可选 `header` slot（标准标题 + 关闭按钮标准位 + 间距），feature 只传标题文案 + 右侧操作；保留完全自定义为 escape hatch。§2 既把"抽屉头部/关闭"列进平台统一列，壳必须真提供。
- **BLK-D【产品+治理·范围漏】adoption matrix 缺 `topic-insights` + `ai-office`（列表层）。** 标准 21 §2 都点名了。→ §5 补齐，显式声明本设计覆盖 = 标准 21 §2 全表；`ai-office` 注明仅列表层 MUST、编辑器例外。

## 2. 已采纳修订（v0.2，无需再议）

- **§5 矩阵订正为实情**：playground = **未用 Frame（1729 行 bespoke）**，不是"部分"；ai-radar = **另一范式**（`SideDrawer` + `useRadarStream` + 卡片/briefing，无 mission 详情页用 Frame），不是"半程对齐"；矩阵加「stream hook」列（playground=useAgentPlaygroundStream✅/social=useSocialMissionStream/radar=useRadarStream 独立/其余无）。
- **共享派生提 `lib/missions/`**：ai-social 现 import `lib/features/agent-playground/derive` = feature 间横向依赖（标准 21 §4 MUST NOT）。通用派生上提 `lib/missions/`，迁移时纠正，别扩散到 7 个 feature。
- **过度抽象收敛原则**：canonical 内容 tab **仅当 ≥3 feature 形态一致才抽**；否则各 feature 用 canonical 原语（DataTable/EmptyState/CitationListItem）自渲染。TaskList/Report 暂不强抽（playground TodoBoard 带 Leader 决策语义、ArtifactReader 带版本/对账，差异大）。
- **事件流/算力面板**（RawEventLog/ComputeUsagePanel）归「canonical 内容 tab 可选复用件」，与 References 同级，🟡 待补，不强制 W0。
- **验收可量化**：以「audit:mission-detail 该 feature 项归 0」为主标准；截图比对为补充、非阻断。deriveXxxView fixture 最低 3 场景（空/running 中间态/completed 终态）。
- **ai-insights 富渲染降级**：迁前列「章节报告/引用/批注/版本/协作」逐项，迁后逐项勾验（"能力不丢"从口号变可勾验收项）。

## 3. 仍待用户拍板（附评审推荐默认值）

| #   | 问题                                                                                               | 推荐默认                                                                                                              |
| --- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Q1  | playground 是否 W0 先迁 Frame 成真·标杆？（A 迁 / B 仅声明 ai-social 为参考、playground 解耦后迁） | **A**（3 路推荐；让"模板源=壳"成事实，否则迁完的 feature 与标杆两套视觉）                                             |
| Q2  | DrawerShell 加标准 `header` slot 统一头部/关闭？                                                   | **加**（直接满足用户"抽屉一致"，保留 escape hatch）                                                                   |
| Q3  | `DrawerShell`(mission 详情) vs `SideDrawer`(标准 22 通用) 双抽屉 canonical 如何收口？              | mission 详情页统一用 `DrawerShell`(+新 header slot)；非 mission 场景用 `SideDrawer`；文档写清边界，避免"同概念两实现" |
| Q4  | `topic-insights` 跟 `ai-insights` 同波迁？                                                         | **同波**（同源衍生，派生层可共用）                                                                                    |
| Q5  | audit 上线节奏                                                                                     | warn-only 出基线 → playground 迁完 → 逐 feature 棘轮 → HARD_ZERO                                                      |

## 3.1 用户拍板结果（2026-05-21，已锁 v1.0）

| #   | 决定                                                                                                                                         |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | ⏪ **改判（用户）：B 路** — playground 零改（活标杆），反向抽其外壳为 canonical（==playground），其余 feature 用；不迁 playground。原 A 作废 |
| Q2  | ✅ **DrawerShell 加可选 `header` slot**（标准标题 + 关闭标准位），保留 escape hatch                                                          |
| Q3  | ✅ **分场景**：mission 详情页用 `DrawerShell`(+header)；非 mission 场景用 `SideDrawer`；文档写死边界                                         |
| Q4  | ✅ `topic-insights` 与 `ai-insights` 同波迁                                                                                                  |
| Q5  | ✅ audit：warn-only 出基线 → playground 迁完清零标杆 → 逐 feature 棘轮 → HARD_ZERO                                                           |

→ 设计锁 **v1.0**，放行条件满足，开 **W0（playground → Frame + DrawerShell header slot）**。

## 4. 放行条件

BLK-A 裁决（Q1）+ BLK-B audit 细则 + BLK-C DrawerShell header（Q2）+ BLK-D 范围补齐 → 锁 v1.0 → 开 W0（playground 迁 Frame）。

> 评审依据源码（四路交叉核实）：`components/common/mission-detail/{MissionDetailFrame,DrawerShell,index}.tsx`、`components/common/team-topology/`、`hooks/features/{useMissionStream,useAgentPlaygroundStream}.ts`、`app/agent-playground/team/[missionId]/page.tsx`（1729 行，未用 Frame）、`components/ai-social/mission-detail/SocialMissionPage.tsx`（唯一 Frame 消费者）、`components/ai-radar/*`（SideDrawer + useRadarStream）、`scripts/utils/audit-ui-discipline.ts`（R6 豁免范本）、标准 21/22/02/10。
