# AI Social Mission 详情页打样 — 前后台整改（统一 Agent Teams UI 的样板）

**状态：** 🟢 P1-P4 前后台打通（代码完成 + tsc/audit/派生测试全绿）；P5 真机验收待用户。commits: 后台 replay `115bf84bc` · 前端接流/标题 `35091d5da` · deriveSocialView `13acc1887` · social 渲染 `2367c2ac8`
**日期：** 2026-05-21
**关联：** [统一 AI Agent Teams UI 设计](../../architecture/frontend/agent-team-ui-unification.md) · [ADR-008](../../decisions/008-agent-team-ui-unification.md)
**定位：** 用户钦定 ai-social 为**第一个打样 feature**——前后台全面整改成「和 playground 一模一样的体验，但内容是 social 自己的」，作为其余 6 feature 的迁移模板。

> 用户拍板（A 方案）：social 用**自己真实的 12 阶段**当任务分解（不假造研究维度），套 playground 呈现风格。**业务定内容、平台定风格。**

---

## 1. 现状根因（前后台全面定位，2026-05-21）

### 前端（`components/ai-social/mission-detail/SocialMissionPage.tsx`）

| #   | 问题                  | 位置     | 根因                                                                                                                                              |
| --- | --------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | **events 永远空**     | L210     | 用 `useAgentPlaygroundStream` → 订阅 `/agent-playground` namespace + playground 的 replay 端点；但 social 事件在 **`/social`** namespace → 拉不到 |
| F2  | **deriveView 不匹配** | L213     | 用 playground 的 `deriveView`（research 专属，期待维度/researcher）→ 喂 social 事件也派生不出东西                                                 |
| F3  | **标题兜底 ID**       | L234-242 | `firstVersion.title → task.prompt → 兜底 "任务${id前8}"`；这些字段空 → 显示 ID                                                                    |
| F4  | **左栏空盒子**        | L384-404 | 复用 playground `TeamRosterPanel` 但没传 action 回调 → 内部操作区渲染空；ai-social 又把取消键塞底部                                               |

### 后端（`modules/ai-app/social/`）

| #   | 现状                                                                                                                                                                                     | 位置                                                            |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| B1  | social mission = **12 阶段顺序流水线**（s1 预算→s2 平台探测→s3 内容转换→s4 Leader评估→s5 封面→s6 正文→s7 润色→s8 发布→s8b重试→s9 验证→s10 Leader签收→s11 持久化→s12 自进化）             | `stages/index.ts`                                               |
| B2  | **已 emit** `social.stage:lifecycle`（payload: `{stage, stepId, primitive, status: started/completed/failed, output?, error?}`）+ `mission:completed/failed/aborted` + `agent:narrative` | `social-pipeline-dispatcher.ts:528-577`                         |
| B3  | **已有事件 buffer**：`SocialEventBuffer`（`read(missionId, since)` → BufferedEvent[]），作为 DomainEventBus adapter 注册                                                                 | `social-event-buffer.service.ts:67` + `ai-social.module.ts:176` |
| B4  | **缺 replay 端点**（playground 有 `GET /agent-playground/replay/:id`，social 无）→ 页面加载/刷新拉不到历史                                                                               | —                                                               |
| B5  | social 无 dimension/researcher 等角色级事件、无 todo（但 stage:lifecycle 够做任务列表）                                                                                                  | —                                                               |

**结论**：social 后端**已经在 emit 阶段事件 + 已 buffer**，缺的是 ① 一个 replay 端点（小，buffer 已就绪）② 前端用对 namespace + 写 social 自己的派生。**不需要大改后端管线**（A 方案：12 阶段就是 social 的任务分解）。

---

## 2. 整改方案（前后台，phased）

### P1 后端：social mission replay 端点（小）

- `GET /ai-social/missions/:missionId/replay?since=<ts>` → `SocialEventBuffer.read(missionId, since)` → `{ events, serverNow }`。
- 鉴权：按 missionId 查 `SocialContentTask`（missionId+userId）确认归属（仿 playground `assertOwnership`）。
- 验收：端点返回该 mission 的累积事件；tsc + 单测。

### P2 前端：接对数据源

- `lib/api/...` 加 `replaySocialMission(missionId, since)` 打 P1 端点。
- `useSocialMissionStream` 改用泛化 `useMissionStream({ namespace:'/social', replay: replaySocialMission })`（替掉自写实现）。
- `SocialMissionPage` L210：`useAgentPlaygroundStream` → `useSocialMissionStream`。
- 标题：优先 `view.mission.topic`（事件）→ `task.title` → `task.prompt` → 兜底。
- 验收：events 不再空；标题不再是 ID。

### P3 前端：`deriveSocialView`（核心，不复用 research 的 deriveView）

- 新建 `lib/features/ai-social/derive-social.ts`：吃 `MissionEvent[]`，产出 `{ mission, stages, todos, agents }`：
  - `mission.topic` ← `mission:started` payload（或 task.title）；`status/startedAt/completedAt/failedAt` ← mission:\* 事件；`progress = {done, total: 12}`。
  - `stages` ← 13 个 social 阶段（stepId→中文 label 映射），status 由 `stage:lifecycle` 推（started→running、completed→done、failed→failed、未出现→pending）。
  - `todos` ← 每阶段一条任务（id=stepId, label, status, role=primitive），喂任务列表 tab。
  - `agents` ← social 角色（Steward/PlatformProbe/ContentTransformer/Composer/PolishReviewer/PublishExecutor/PublishVerifier/Leader），状态由其阶段推。
- stepId→label 映射表（13 条）见 §3。
- 验收：fixture 测试（空/running 中间态/completed）三场景；任务列表渲染 social 12 阶段。

### P4 前端：左栏 + 任务列表渲染 social 内容

- 左栏角色卡用 social 角色（不是 research 的 Leader/Researcher/Reviewer/Writer），风格沿用 canonical 卡。
- 若 playground 的 `TeamRosterPanel`/`MissionTodoBoard` 是 research 硬编码 → generalize 成内容无关 canonical（或 social 专用，风格一致）。**P4 视 P3 接通后真机表现再定**。
- 修 F4 空盒子（不传空 action 区 / 用 canonical）。

### P5 真机验收

- 跑一个 social mission：标题对、任务列表出 12 阶段、状态实时推进、完成后刷新（replay 水合）仍在。与 playground 体验对齐。

---

## 3. social 13 阶段 stepId → label 映射（deriveSocialView 用）

| stepId                     | label           | 角色(primitive)    |
| -------------------------- | --------------- | ------------------ |
| s1-mission-budget-eval     | 预算评估        | Steward            |
| s2-platform-probe          | 平台探测        | PlatformProbe      |
| s3-content-transform       | 内容转换        | ContentTransformer |
| s4-leader-assess-transform | Leader 评估转换 | Leader             |
| s5-cover-craft             | 封面制作        | CoverArtist        |
| s6-body-compose            | 正文撰写        | Composer           |
| s7-polish-review           | 润色审核        | PolishReviewer     |
| s8-publish-execute         | 发布执行        | PublishExecutor    |
| s8b-publish-retry          | 发布重试        | PublishExecutor    |
| s9-publish-verify          | 发布验证        | PublishVerifier    |
| s10-leader-signoff         | Leader 签收     | Leader             |
| s11-mission-persist        | 结果持久化      | —                  |
| s12-self-evolution         | 自进化复盘      | —                  |

> stepId 实际值以后端 `stage:lifecycle` payload.stepId 为准（真机/单测核对）；上表为映射基准。

## 4. 模板沉淀（其余 6 feature 复用）

打样跑通后，把"接对 namespace + replay 端点 + deriveXxxView（feature 自己的阶段）+ Frame slot"固化为迁移清单，供 research/insights/planning/simulation/writing/teams 照搬。
