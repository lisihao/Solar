# 008. 统一 AI Agent Teams UI - 业务定内容 / 平台定风格 + audit 强制

**Date**: 2026-05-21
**Status**: ✅ Accepted（四路评审 4× 批准 + 用户拍板，2026-05-21，v1.0 锁定）。**W0 走 B 路（用户改判）**：playground 零改（活标杆），反向把其外壳原样抽成 canonical（== playground），其余 feature 用抽出来的壳 → 一模一样；DrawerShell 加 header slot；audit warn→棘轮→焊死；DrawerShell(mission)/SideDrawer(其他)分场景；topic-insights 同 insights 波。成功标准 = 每 feature 体验与现 playground 完全一致（硬验收，真机比对）
**评审纪要**: [../architecture/frontend/agent-team-ui-unification-review.md](../architecture/frontend/agent-team-ui-unification-review.md)
**关联设计文档**: [architecture/frontend/agent-team-ui-unification.md](../architecture/frontend/agent-team-ui-unification.md)
**关联标准**: [21-agent-teams-presentation.md](../../.claude/standards/21-agent-teams-presentation.md)（本 ADR 落地并升级它）· [22-frontend-ui-component-governance.md](../../.claude/standards/22-frontend-ui-component-governance.md)

## 背景

平台约 10 个 ai-app 本质都是「agent 团队跑 mission」，但各自造了详情页（头部/左团队/右 tab/抽屉/进度各一套），视觉与结构不一致。用户诉求：所有 AI App 都是 agent team，应参考 playground 形成全平台 UI 一致性——左侧团队、右侧 tab、tab 点开的抽屉，**内容业务自定义、风格平台统一**。

## 决策

1. **核心原则：业务定内容，平台定风格**。feature 只提供数据 + slot 内容；header / 左团队壳 / tab 条 / tab 内容原语 / 抽屉壳 / 弹层壳 / 进度条 全部由 canonical 壳统一。
2. **canonical 壳作为一致性载体**（绝大部分已存在）：`MissionDetailFrame`（头部+左团队 slot+右 tab+内容 slot）+ `DrawerShell` + `ModalShell` + `StageStepper` + `MissionActionGroup` + `team-topology`/角色卡 + `useMissionStream`（已泛化）+ canonical 内容 tab（起步）。
3. **feature 接入 = 填 slot**：`useMissionStream` 取实时 → `deriveXxxView`（纯函数 + fixture）→ `MissionDetailFrame` 注入业务团队/tabs/内容 → `DrawerShell`/`ModalShell` 包业务抽屉/弹层。**禁止 feature 自写 header/tab 条/抽屉壳/进度条或 fork canonical 壳**。
4. **audit 强制**：新增 `audit:mission-detail-discipline`，扫 mission 类 feature 自写壳的模式，出基线 → 逐 feature 归 0 → 焊死 HARD_ZERO（仿标准 22 卡片治理）。
5. **地基先行 + 逐 feature 迁移**（用户已拍板）：地基已大半就位 → 立 audit → 按"重/收益"逐个迁（ai-radar 收尾 → research → planning → simulation → writing → teams → insights）；旧详情**真机跑通才删**。
6. **富渲染不丢**：ai-insights 等的章节报告/批注/版本降级为挂 Frame content slot 的可插拔 artifact 面板（标准 21 ADR 已定）。

## 影响

- 全平台 mission 详情页收敛到一套壳，新 feature 接入零样式成本；一致性由 audit 锁定。
- 大重构，分波；本 ADR 通过后并入标准 21（升级为「带 audit 强制的设计系统」）。

## 待评审（详见设计文档 §10）

分区表完整性 / 壳清单是否齐 / playground 是否已用 Frame（W0 复核）/ 迁移顺序 / audit 检测边界 / insights 富渲染降级。
