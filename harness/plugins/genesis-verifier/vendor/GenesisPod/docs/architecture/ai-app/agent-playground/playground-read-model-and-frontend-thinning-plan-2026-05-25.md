# Playground Read Model 与前端瘦身优化方案

**日期：** 2026-05-25  
**范围：** `agent-playground` mission detail / replay / artifact / rerun 查询链路  
**目标：** 把 Playground 从“前后端共同解释 mission”收敛为“后端定义 mission 真相，前端消费 canonical view”，并采用**语义先行、后端单轨覆盖、前端一次切换**的迁移方式

**关联文档：**

- [mission-pipeline-baseline.md](./mission-pipeline-baseline.md)
- [mission-pipeline-replay-api.md](./mission-pipeline-replay-api.md)
- [agent-playground-target-boundary-and-directory-blueprint-2026-05-24.md](./agent-playground-target-boundary-and-directory-blueprint-2026-05-24.md)
- [agent-team-boundary-audit-2026-05-08.md](./agent-team-boundary-audit-2026-05-08.md)
- [../frontend/agent-team-ui-unification.md](../../frontend/agent-team-ui-unification.md)

---

## 1. 结论

当前 `Playground` 后端复杂度总体合理，因为它承载的是 mission runtime、lifecycle、一致性、checkpoint、rerun 与 event replay 这些硬复杂度。

当前主要问题不在“后端太复杂”，而在：

1. 前端承担了过多 mission 语义归约职责。
2. live event 与 persisted snapshot 的拼接逻辑外溢到页面层。
3. artifact 兼容、terminal re-fetch、resumable/rerunability 判断没有统一的 canonical read model。

因此，本方案不主张削弱后端，而主张：

1. 新增后端 `query / projector / read model` 层。
2. 让前端从“自己推导真相”改为“消费后端给出的真相”。
3. 将实时事件流降级为“增量通知流”，而不是前端真相重建来源。
4. 不接受双轨真相并行；切换前先冻结语义，再由后端一次性覆盖。

---

## 2. 当前症状

### 2.1 前端过重的表现

当前前端 detail 页不仅负责展示，还负责：

1. 事件归约为 mission/stage/agent 状态。
2. persisted snapshot 与 live event 双源拼接。
3. terminal event 后的 re-fetch 时机管理。
4. resumable mission 判断。
5. artifact fallback / synthesize / 旧结构兼容。
6. stage stepId 到高层 stage 的语义映射。
7. token / cost / memory 的部分口径归并。

这意味着页面层在参与定义业务真相，而不是仅消费业务真相。

### 2.2 后端读模型不够收口

当前后端执行层已经具备：

1. `MissionStore`
2. `MissionEventBuffer`
3. `MissionCheckpointService`
4. `MissionLifecycleManager`
5. `PlaygroundPipelineDispatcher`

但前端仍需自己把这些层的输出重新拼成一个“可展示的 mission detail view”。这说明查询侧缺少统一投影层。

---

## 3. 优化目标

优化完成后，应满足以下状态：

1. mission 真相只有一份 authoritative source，位于后端。
2. 前端不再自行判定 mission terminal status、stage status、agent phase。
3. 前端不再负责 artifact 结构修补与旧版本兼容。
4. 前端不再通过事件类型表手工决定何时 re-fetch DB。
5. 实时流只负责通知局部变化或触发 refresh，不再要求页面重建完整状态。
6. 切换过程中不存在“旧前端真相”和“新后端真相”并行运行。

---

## 4. 迁移原则

### 4.1 不做双轨

本方案明确不采用“双轨真相并行”的迁移方式。

不允许出现以下状态：

1. 前端旧 derive 继续作为主 UI 的 authoritative source。
2. 后端 read model 与前端 derive 同时对 mission/stage/agent 真相做裁决。
3. 页面运行时对比两套真相后再决定渲染结果。

允许保留的只有：

1. raw event timeline
2. debug 面板
3. 纯展示型格式化工具

这些保留代码不得继续参与 mission 语义判断。

### 4.2 语义先行

在任何代码切换之前，必须先冻结 canonical 语义。

必须先定义并锁定：

1. `mission.status`
2. `stage.status`
3. `agent.phase`
4. `resumable`
5. `rerunnableStages`
6. `artifact` canonical schema
7. refresh semantics

只有当上述语义以 contract 和测试形式被焊死后，前端才允许切到新 read model。

---

## 5. 目标架构

### 5.1 新增读模型层

建议在 `backend/src/modules/ai-app/agent-playground/mission/` 下新增：

```text
query/
  mission-query.service.ts
projectors/
  mission-detail.projector.ts
  mission-summary.projector.ts
  mission-stage.projector.ts
  mission-agent.projector.ts
  artifact.projector.ts
contracts/
  mission-detail-view.contract.ts
```

职责划分：

1. `MissionStore` 继续负责持久化写模型。
2. `MissionEventBuffer` 继续负责 replay / persisted events。
3. `MissionCheckpointService` 继续负责 checkpoint。
4. `MissionQueryService` 聚合 DB + checkpoint + events。
5. `Projector` 负责输出前端稳定消费的 canonical view。

### 5.2 前端目标形态

前端 detail 页最终只做：

1. 获取 `MissionDetailView`
2. 订阅 stream
3. 根据 `viewVersion` 或 refresh hint 触发局部刷新
4. 渲染 tabs / panels / drawers / actions

前端不再执行领域级状态归约。

---

## 6. Canonical Contract

在实现 contract 之前，必须先完成语义定义文档。推荐将下列语义直接沉淀到同目录的后续 contract 文档或 ADR 中：

1. `mission.status` 的终态判定规则
2. `quality-failed` 与 `failed` / `completed` 的边界
3. `reopened` 如何映射为 detail view 中的当前 status
4. stage 聚合时 step 的归属规则
5. resumable 与 rerunnable 的判定前提
6. artifact 缺字段或旧版本数据的 canonical 归一规则

建议新增统一的 detail view 契约：

```ts
type MissionDetailView = {
  mission: {
    id: string;
    topic: string;
    status:
      | "starting"
      | "running"
      | "completed"
      | "failed"
      | "cancelled"
      | "quality-failed";
    startedAt?: string;
    finishedAt?: string;
    finalScore?: number;
    failureMessage?: string;
    resumable: boolean;
    canCancel: boolean;
    rerunnableStages: Array<{
      id: string;
      allowed: boolean;
      reason?: string;
    }>;
  };
  stages: Array<{
    id: string;
    label: string;
    status: "pending" | "running" | "done" | "failed" | "skipped";
    startedAt?: string;
    endedAt?: string;
    detail?: string;
    attempts?: number;
  }>;
  agents: Array<{
    id: string;
    role: string;
    phase: "pending" | "running" | "completed" | "failed";
    dimension?: string;
    modelId?: string;
    retryCount?: number;
    failureMessage?: string;
  }>;
  reportArtifact?: unknown;
  references?: unknown;
  cost?: unknown;
  memory?: unknown;
  timelineVersion: number;
  snapshotVersion: number;
};
```

关键要求：

1. `mission.status` 为唯一终态判定来源。
2. `stages[]` 已完成 canonical 聚合，前端不得再根据 stepId 二次推导。
3. `agents[]` 已完成 phase 投影，前端不得再根据 raw events 推导。
4. `reportArtifact` 已标准化，不允许前端自行 synthesize canonical shape。

---

## 7. 应下沉的前端复杂度

### 6.1 必须下沉

1. mission status 归约
2. stage status 聚合
3. agent phase 聚合
4. resumable / rerunnable 判断
5. artifact 兼容修补
6. terminal re-fetch 语义
7. cost / token / memory 口径归并

### 6.2 可保留在前端

1. tabs / drawer / modal / collapse 等交互状态
2. timeline、report、cost panel 的渲染逻辑
3. stream 连接管理
4. 轻量 optimistic UI
5. 列表排序、筛选、格式化、图表数据整形

原则：

只要某段逻辑在回答“mission 现在真实处于什么状态”，就不该继续留在页面层。

---

## 8. 后端改造方案

### 8.1 MissionQueryService

新增 `MissionQueryService`，聚合：

1. `MissionStore.getById`
2. `MissionCheckpointService`
3. `MissionEventBuffer.read` / `readPersisted`
4. report versions / artifact data
5. rerun guard 信息

输出：

1. `MissionDetailView`
2. `MissionSummaryView`
3. `MissionTimelineView`

### 8.2 Projector 拆分

避免把查询层再次做成 god-class。推荐拆分：

1. `MissionDetailProjector`
2. `MissionStageProjector`
3. `MissionAgentProjector`
4. `ArtifactProjector`

规则：

1. projector 只投影，不写库。
2. lifecycle 语义统一来自 store / manager / checkpoint 的 authoritative 数据。
3. 所有枚举在 contract 层集中定义。

### 8.3 Stream 收口

事件流不再要求前端自行重建完整 mission。建议逐步把 payload 收口为：

1. 事件类型
2. refresh hints
3. `viewVersion`

例如：

```ts
{
  type: "agent-playground.stage:lifecycle",
  missionId: "...",
  refreshHints: ["stages", "agents"],
  viewVersion: 42
}
```

这样前端只需判断是否刷新对应局部数据。

---

## 9. 前端改造方案

### 9.1 页面层拆分

建议将详情页收敛为：

1. `MissionDetailPageContainer`
2. `useMissionDetailView(missionId)`
3. `MissionDetailLayout`

页面层只负责编排与渲染，不再承担 mission truth 归约。

### 9.2 Hook 收口

推荐最终收口为：

1. `useMissionDetailView`
2. `useMissionStream`
3. `useMissionActions`

不再让 hook 内部继续增长复杂 derive 逻辑。

### 9.3 组件契约

组件统一吃 canonical props，例如：

1. `MissionHeader`
2. `MissionStagesPanel`
3. `MissionAgentsPanel`
4. `MissionArtifactPanel`
5. `MissionCostPanel`

组件不直接消费 raw events + persisted row 的混合物。

---

## 10. 单轨切换顺序

### Phase 0：冻结语义

目标：先定义唯一真相，而不是先改实现。

动作：

1. 梳理并冻结 `mission.status` 语义表。
2. 梳理并冻结 `stage.status` 聚合规则。
3. 梳理并冻结 `agent.phase` 投影规则。
4. 梳理并冻结 `resumable` / `rerunnableStages` 判定规则。
5. 梳理并冻结 `artifact` canonical schema。
6. 梳理并冻结 refresh semantics。

交付物：

1. 语义文档
2. contract types
3. 语义 fixtures

### Phase 1：后端实现完整 read model

目标：后端一次性覆盖 canonical 语义。

动作：

1. 定义 `MissionDetailView`
2. 新增 `MissionQueryService`
3. 新增 `GET /missions/:id/view`
4. 用 projector 完成 mission/stage/agent/artifact/cost/memory 投影
5. 用 contract tests 焊死输出

验收：

1. 新 view 覆盖现详情页全部主数据需求。
2. 语义判断不再依赖前端 derive。

### Phase 2：前端一次切到 canonical view

目标：前端主 UI 不再消费旧 authority。

动作：

1. 详情页优先读取 `MissionDetailView`
2. 删除旧 `deriveView(events)` 对 mission/stage/agent 真相的主路径影响
3. 删除 terminal re-fetch 规则表
4. 页面保留 raw timeline/debug 但不得参与语义判断

验收：

1. 详情页不再依赖前端自行计算 mission/stage/agent 真相。

### Phase 3：artifact 与 rerunability 下沉

目标：去掉前端最重的兼容逻辑。

动作：

1. 后端输出标准 artifact
2. 后端输出 `resumable` / `rerunnableStages`
3. 前端删除 synthesize/fallback 逻辑

### Phase 4：删除旧 authority

目标：确保系统只剩单轨真相。

动作：

1. 删除或降级旧前端归约器
2. 旧 derive 仅保留 timeline/debug 辅助能力
3. 对 query layer 与前端 page integration 补足测试

---

## 11. 测试策略

由于不接受双轨，必须以测试替代迁移期运行时对照。

### 11.1 Contract Tests

必须覆盖：

1. completed mission
2. failed mission
3. quality-failed mission
4. cancelled mission
5. reopened / rerun mission
6. resumable mission

### 11.2 Fixture Replay Tests

拿真实 mission fixtures：

1. events
2. DB snapshot
3. checkpoint
4. artifact versions

直接喂后端 projector，断言 `MissionDetailView` 输出。

### 11.3 Page Integration Tests

前端只测：

1. 给定 `MissionDetailView` 的渲染结果
2. refresh 事件是否触发局部刷新
3. rerun/cancel 等操作是否调用正确接口

---

## 12. 优先级最高的三刀

如果只做最值钱的三项，优先顺序如下：

1. 状态归约下沉  
   mission / stage / agent 的 authoritative 状态收回后端。

2. artifact 标准化下沉  
   前端停止兼容旧结构与 synthesize canonical artifact。

3. resumable / rerunability 下沉  
   前端只展示能否续跑/重跑及原因。

---

## 13. 风险与控制

### 11.1 风险

1. 语义未冻结就开始切换，导致单轨切换后真相错误。
2. query 层可能演化成新的 god-class。
3. event contract 与 view contract 继续漂移。
4. 旧前端隐藏兜底逻辑未被纳入后端 contract。

### 11.2 控制措施

1. 先冻结语义，再允许切换实现。
2. projector 拆分，不允许所有逻辑回流单一 service。
3. 新增 contract tests，锁定：
   - mission status
   - stage status
   - agent phase
   - artifact schema
   - resumable/rerunability 输出
4. 用 fixture replay tests 覆盖历史 mission 样本，而不是运行时双轨对照。

---

## 14. 验收指标

优化完成后，至少应达到：

1. detail 页主文件体量显著下降。
2. 前端不再决定 mission/stage/agent 真相。
3. terminal event 的手工 re-fetch 条件大幅减少。
4. artifact fallback / synthesize 前端逻辑基本消失。
5. 新增后端 contract tests 覆盖 canonical detail view。
6. 刷新页面、事件丢失、服务重启后，详情页展示结果仍一致。
7. 系统中不存在两套并行的 mission truth authority。

---

## 15. 最终判断

本方案不是单纯“前端减负”，而是把系统从：

**前后端共同解释 mission**

收口到：

**后端定义 mission，前端消费 mission**

对于 `Playground` 这类长生命周期、多阶段、可续跑、可回放的 Agent Team mission app，这种收口是继续演进前最值得优先完成的结构性优化。

本次迁移路线明确为：

**语义先行，后端单轨覆盖，前端一次切换，不保留双轨真相。**
