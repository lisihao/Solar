# Writing 前后端一致性重构方案（对齐 Agent-Playground 标杆）

> 目标：把 AI Writing 的实时链路从「旧 project-room WS + 前端关键词猜测进度」重构到
> playground 同款的「`writing.*` 框架事件 → DomainEventBus → SocketBroadcastAdapter →
> mission-room socket」+「canonical view REST truth + WritingArtifact projector」+
> 前端「`useMissionStream` 双轨数据流 + canonical mission-detail 组件复用」。
>
> 状态：**设计稿（只写设计，不含实现代码）**
> 作者：全栈架构师 · 日期：2026-05-31
> 关联测绘：后端输出面 + playground 桥接模板 / playground 前端消费模板 / writing 前端现状

---

## 0. 锁定目标与约束

1. **后端**：保留新 pipeline 已经在发的干净框架事件（`writing.stage:* / writing.agent:* / writing.mission:* / writing.cost:* / writing.budget:*`），补两个缺口：
   - **gateway 桥**：注册 `writing.*` 事件类型 + 用 `SocketBroadcastAdapter` 把 DomainEventBus 事件按 missionId 广播到 `writing:${missionId}` room（照抄 playground）。
   - **artifact 暴露**：新增 REST endpoint 走 `WritingArtifactProjector`，把 `WritingArtifact` + 3 个 view（chapterList / fullText / qualityReport）暴露给前端。
2. **前端**：弃用旧 `useWritingWebSocket`（13 个具名 `socket.on` + 内部 setState）+ `aiWritingStore.pollMissionStatus`（15 分钟前端轮询 + `stepToPhase` 关键词猜测），改成消费 `writing.*` 事件 + canonical `useMissionDetailView` + `WritingArtifact`。**不再使用旧 `WritingEventType`**。
3. **UI 治理**：复用 canonical 组件（`MissionDetailFrame / StageStepper / RoleCard / MissionTaskList / MissionControlCard / Modal / EmptyState / ...`），禁止自写已有 canonical 的卡片/弹层/空态；emoji 全换 Lucide。
4. **兼容约束**：老路（`WRITING_PIPELINE_LEGACY` 开关走旧 executor + 旧 `WritingEventEmitterService`）仍发老事件。**前端重构后老路显示降级可接受**（老路只是回退路径），但**不能崩**——前端必须对「无 `writing.*` 事件流 + 无 canonical view」做优雅空态降级。

---

## 1. 现状与目标态对比（已验证）

### 1.1 后端现状（已读源码确认）

| 事项                              | 现状                                                                                                                                                                                                       | 锚点                                                    |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| 新 pipeline 已发 `writing.*` 事件 | ✅ 通过 `DomainEventBus.emit` 发出，三来源（stage 直发 / dispatcher 桥接 / AgentInvoker 中继）                                                                                                             | dispatcher / event-relay / narrate                      |
| `writing.*` 事件类型注册          | ❌ **未注册** —— `ai-writing.module.ts` 无 `registry.registerAll(...)`；未注册 type 被 DomainEventBus **drop + warn**                                                                                      | `ai-writing.module.ts:326-376`（onModuleInit 无注册）   |
| DomainEventBus → socket 桥        | ❌ **无** —— `ai-writing.gateway.ts` 注入的是旧 `WritingEventEmitterService`，按 **projectId** room 推，无 `DomainEventBus` / `SocketBroadcastAdapter` / ownership / JWT                                   | `ai-writing.gateway.ts:49-123`                          |
| WritingArtifact REST 暴露         | ❌ **零 controller** 暴露 projector 的 3 个 view                                                                                                                                                           | `ai-writing.controller.ts`（975 行，grep 无 view 端点） |
| `WritingArtifactProjector` DI     | ⚠️ 是 plain class（无 `@Injectable()`，`projector.ts:85`），但**已**在 module providers 注册（`module.ts:288`），且无构造依赖 → DI 可解析。**功能正常但与文件头注释不符**，建议补 `@Injectable()` 消除歧义 | `projector.ts:85` / `module.ts:288`                     |

### 1.2 playground 标杆（照抄模板，已读源码确认）

| 模板                                  | 文件:行                                                                                                                                      |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 事件类型清单 + zod schema             | `playground/events/agent-playground.events.ts` + `.event-schemas.ts`                                                                         |
| onModuleInit 注册事件                 | `playground/module/agent-playground.module.ts:285`（`registry.registerAll(...)`）                                                            |
| afterInit 注册 SocketBroadcastAdapter | `playground/agent-playground.gateway.ts:52-64`（`eventTypePrefix:"agent-playground.", roomPrefix:"playground"`）                             |
| join + JWT + ownership 鉴权           | `playground/agent-playground.gateway.ts:66-134`（`extractUserId` + ownership cache→DB fallback + blocklist fail-open + `await client.join`） |
| canonical view REST                   | `mission-read.controller.ts:95-107`（`GET missions/:id/view`）                                                                               |
| replay 兜底                           | `mission-read.controller.ts:330-350`（`GET replay/:missionId?since=`）+ module 注册 `MissionEventBuffer` adapter                             |

### 1.3 前端现状 vs 目标态

| 维度     | 现状（writing）                                                                                             | 目标态（playground 标杆）                                                                                     |
| -------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| WS hook  | `useWritingWebSocket`：13 个 `socket.on` + 13 段 setState，无 replay/hydrate/polling，只 bool `isConnected` | `useMissionStream({namespace:'/ai-writing', replay})`：`events[]` + 4 态 `connState` + hydrate + polling 兜底 |
| 进度真相 | `aiWritingStore.pollMissionStatus`（2s 轮询 15 分钟）+ `stepToPhase` 关键词猜测                             | `useMissionDetailView`（canonical view，后端投影 truth）+ WS 仅 immediacy                                     |
| view 层  | page.tsx 3901 行自写 header/布局；`WritingTeamPanel` 靠 `missionMessage` 关键词推 phase                     | canonical `MissionDetailFrame` + `lib/missions/derive` 投影 → `StageView/AgentView`                           |
| artifact | 无统一 artifact，章节散在 `chapters` Map                                                                    | `WritingArtifact` + 多视图 Reader（单 artifact 喂多视图）                                                     |
| UI 治理  | 大量 emoji、自写气泡/dropdown/toast、orphan `WritingCanvasView.tsx`                                         | canonical 组件 + Lucide                                                                                       |

---

## 2. 架构总览（目标态数据流）

```
后端                                                          前端
────                                                          ────
新 pipeline stages / AgentInvoker / dispatcher
      │ emit  writing.*  (DomainEventBus.emit)
      ▼
DomainEventBus ──[校验:必须已注册 type]── registerAll(WRITING_EVENTS)   ① 注册（缺口1）
      │
      ├─▶ SocketBroadcastAdapter(eventTypePrefix:"writing.", roomPrefix:"writing")  ② 桥（缺口1）
      │        └─ broadcast → socket room  writing:${missionId}
      │                                                    │
      │                                            useMissionStream('/ai-writing', writingReplay)
      │                                                    │  events[] + connState
      │                                                    ▼
      ├─▶ MissionEventBuffer adapter ── GET writing/replay/:id?since=  ③ replay 兜底（可选）
      │                                                    │ hydrate / polling
      ▼
WritingArtifactProjector ── GET writing/missions/:id/view  ④ canonical truth（缺口2）
      (toChapterList/toFullText/toQualityReport)            │  useWritingMissionView (coalescing/polling/abort)
                                                            ▼
                                          lib/missions/derive → StageView/AgentView
                                          + WritingArtifact view
                                                            ▼
                                          MissionDetailFrame + StageStepper + RoleCard
                                          + ArtifactReader(多视图) + 保留的 writing 业务组件
```

**双轨原则**（照抄 playground §0 心智模型）：

- **轨 A（immediacy）**：WS `events[]` —— 实时 token、stage 切换、retry 闪烁、live 修订 banner。前端自己 derive 派生态。
- **轨 B（truth）**：REST canonical view —— mission status / stages / agents / artifact / cost。后端已 normalize。
- **桥**：WS 事件 payload 里带 `refreshHints[]`（若 writing 事件未带，则用 terminal-event 触发 + WS 退化 `shouldPoll` 兜底）。

---

## 3. 后端变更清单

### 3.1 缺口 1：事件类型注册 + Socket 桥

**新建** `backend/src/modules/ai-app/writing/events/writing.events.ts`

- 照 `playground/events/agent-playground.events.ts` 的工厂模式：`S(suffix, schema)` 强制 `writing.` 前缀 + zod schema。
- 列全测绘 ① 的 topic：
  - `writing.stage:lifecycle` / `writing.stage:stalled` / `writing.stage:degraded`
  - `writing.mission:started/completed/cancelled/failed/aborted`
  - `writing.agent:lifecycle/thought/action/observation/narrative`
  - `writing.cost:tick` / `writing.budget:warning-soft` / `writing.budget:exhausted`
- **关键**：`writing.stage:degraded` 有两套 payload（framework 桥 3 字段 vs invoker role-degrade 7 字段），schema 用 **union** 容纳，否则其一会被 DomainEventBus 校验 drop。

**新建** `backend/src/modules/ai-app/writing/events/writing.event-schemas.ts`

- 每个 topic 对应 zod schema（payload 形状见测绘 ①）。schema 是 DomainEventBus 校验的依据，必须与 stage/relay 实际 emit 的 payload 字段对齐。

**改** `backend/src/modules/ai-app/writing/ai-writing.module.ts`

- onModuleInit 内新增 `this.eventTypeRegistry.registerAll(WRITING_EVENTS)`（注入 `EventTypeRegistry`/`DomainEventBus`，从 `ai-harness/facade`）。
- providers 注册新 gateway（见下）+ 可选 `MissionEventBuffer` adapter。
- **不要**删旧 `WritingEventEmitterService` / `AiWritingGateway`（老路兼容仍需）—— 见 §3.3 决策。

**改 / 新建 gateway**（二选一，见 §3.3 决策）：`backend/src/modules/ai-app/writing/ai-writing.gateway.ts`（改）或新建 `writing-mission.gateway.ts`

- 照 `backend/src/modules/ai-app/playground/agent-playground.gateway.ts`：
  - 注入 `DomainEventBus`, `SocketBroadcastAdapter`(from `ai-harness/facade`), `MissionOwnershipRegistry`, `JwtService`, writing 的 MissionStore（`WritingMissionStoreService`）, `CacheService`。
  - `afterInit()` 注册 `new SocketBroadcastAdapter(this.io, { id:"writing.socket", eventTypePrefix:"writing.", roomPrefix:"writing" })`。
  - `@SubscribeMessage("join")`：`extractUserId`（JWT from handshake.auth + blocklist fail-open）+ ownership（cache miss → DB fallback，区分 `SERVICE_UNAVAILABLE` / `MISSION_NOT_FOUND`）+ `await client.join('writing:${missionId}')`。`leave` 同构。
  - **room 维度从 projectId 改为 missionId**（mission-scoped 是实时流正确粒度）。

**注意**：新 gateway 用 mission-scoped room（`writing:${missionId}`），与旧 gateway 的 project-room（`writing:${projectId}`）**room key 前缀相同但语义不同**。若同一 namespace 共存会冲突 → 见 §3.3。

### 3.2 缺口 2：WritingArtifact REST 暴露

**新建** `backend/src/modules/ai-app/writing/api/writing-mission-read.controller.ts`（或加到现有 `ai-writing.controller.ts`，见 §3.3 决策）

- 照 `mission-read.controller.ts`：
  - `GET writing/missions/:id/view` → 走 `WritingMissionStoreService` 取 mission ctx → `WritingArtifactProjector.project(ctx)` + `toChapterList/toFullText/toQualityReport` → 返回 canonical envelope `{ mission, stages, agents, writingArtifact, cost, refreshHints? }`。鉴权 `assertReadAccess`（own ∨ PUBLIC）。
  - （可选）`GET writing/replay/:missionId?since=` → 从 `MissionEventBuffer` 读累积事件兜底，内存空时 `readPersisted` 从 DB。
- **artifact 形状契约**：直接复用 `writing-artifact.projector.ts` 已定义的 `WritingArtifact` + `WritingChapterListView` / `WritingFullTextView` / `WritingQualityReportView`，前端 mirror 这些 type。

**补** `backend/src/modules/ai-app/writing/mission/projectors/writing-artifact.projector.ts`

- 加 `@Injectable()` 装饰器（line 85），消除「plain class 当 provider」歧义（功能不变，但与文件头注释一致 + 防未来加构造依赖时 DI 失败）。

### 3.3 关键架构决策（需用户确认，**不擅自选**）

> 按 Karpathy 原则暴露多义性，列出解读 + 影响面：

**决策 A：新 gateway 是「改造旧 gateway」还是「新建并行 gateway」？**

- **A1 改造旧 `ai-writing.gateway.ts`**：把 projectId-room 换成 missionId-room + 加 DomainEventBus 桥。
  - 影响：老路 `WritingEventEmitterService.emitToProject` 依赖的 project-room 失效 → 老路实时推送断（但任务约束允许老路降级，且老路有 REST 轮询兜底）。工作量小。
  - 风险：老路前端（重构前的页面）若还在用 project-room 会立刻断流。需确认老路前端是否已随本次一并重构。
- **A2 新建 `writing-mission.gateway.ts`（独立 namespace 如 `/ai-writing-mission`）**：新旧并存。
  - 影响：老 gateway 完全不动，老路零回归；前端新 hook 连新 namespace。工作量略大（多一个 namespace + 前端 replay 端点对齐）。
  - 风险：两套 WS 基础设施并存一段时间，需在 B5 单点切换后清理旧 gateway。
- **倾向**：A2（零回归，符合「新旧并存 + 单点切换」既有 B4/B5 模式），但需用户拍板。

**决策 B：artifact endpoint 放新 controller 还是现有 `ai-writing.controller.ts`？**

- B1 新建 `writing-mission-read.controller.ts`：与 playground `mission-read.controller.ts` 同构，职责清晰。
- B2 加到现有 controller（975 行）：少一个文件，但该 controller 已巨型。
- **倾向**：B1。

**决策 C：是否接入 `MissionEventBuffer` replay 兜底？**

- 接：与 playground 完全对齐（断线/掉包恢复）。但 writing mission 多为长任务，buffer 内存占用需评估。
- 不接：前端靠 terminal-event refetch + polling 兜底，少一层韧性但可用。
- **倾向**：先接 hydrate（进页面拉一次）+ polling 兜底，replay buffer 作为 P2 增强。

---

## 4. 前端变更清单

### 4.1 WS hook 层

**新建** `frontend/hooks/features/useWritingStream.ts`（薄封装，照 `useAgentPlaygroundStream.ts`）

- `useMissionStream(missionId, { namespace:'/ai-writing'（或决策A2的新namespace）, replay: writingReplay })`。
- 默认 `joinEvent:'join'/leaveEvent:'leave'/idKey:'missionId'/acceptEvent:(t)=>t.includes('.')`。
- 得到 `events[]`（`MissionEvent{type,payload,timestamp}`）+ 4 态 `connState`。

**改 / 弃用** `frontend/hooks/features/useWritingWebSocket.ts`（415 行）

- 弃用 13 个具名 `socket.on` + 内部 setState 模式。
- **过渡期保留**：老路（legacy pipeline）若仍发老事件，可保留此 hook 仅供老路页面降级用；新页面不再 import。最终随老路清理删除。

**新建** `frontend/services/ai-writing/api.ts` 增 `writingReplay(missionId, sinceTs?)` + `getWritingMissionView(id, {signal})`（照 playground `services/agent-playground/api.ts`，走 `unwrapStandard`）。

### 4.2 Store 层

**改** `frontend/stores/ai-writing/aiWritingStore.ts`（914 行）

- **移除**实时态字段：`isMissionRunning / missionProgress / missionMessage / activeAgentIds / isStuckMission / stuckMissionId`（迁到 canonical `missionView`）。
- **移除** `pollMissionStatus`（L201-413，15 分钟前端轮询）+ `stepToPhase`（L136-162，关键词猜测）+ `activePollController` module-level 单例（L110，反向洞察 #8 风险点）。
- **保留** CRUD actions：projects / volumes / chapters / storyBible / characters（L420-649）+ `conversationHistory`（L870）。
- **新建** `frontend/hooks/features/useWritingMissionView.ts`（照 `useMissionDetailView.ts`，192 行，coalescing 250ms + in-flight+queued + AbortController 抢占 + terminal 停 polling + `shouldPoll` 兜底）。**不要为实时态新建 Zustand slice**（playground 实时态全在 hook 的 useState + useMemo，writing 照此）。

### 4.3 派生层

**新建** `frontend/hooks/features/useWritingDerivedView.ts`（仿 `useMissionLegacyView.ts`，但 writing 事件类型自定义）

- 接 `(missionView, events)` → 合并 canonical view + raw events，每字段「canonical 优先 + events 派生兜底」双路。
- **务必抄的坑**：后端 harness trace 事件可能是 **colon 形态**（`agent:thought`），事件后缀需与后端 `writing.events.ts` emit 的 type **精确对齐**，否则派生永远空。
- 接 `lib/missions/derive`（`deriveMissionView/deriveStageView/deriveAgentView`）→ canonical `MissionView/StageView/AgentView`。`derive/index.ts` docstring 已把 writing 列为目标 feature。
- writing 的「维度→章节」状态机（若新 pipeline 发 chapter 级事件）仿 `dvDeriveDimensionPipelinesFromEvents`，章节状态 rank 防回退。

### 4.4 页面 / 组件层

**改** `frontend/app/ai-writing/[id]/page.tsx`（3901 行，巨型）

- 双轨编排骨架（照 playground page）：`useWritingStream` + `useWritingMissionView` + refreshHints 桥（或 terminal-event 三连拉）+ legacy 适配 `useWritingDerivedView`。
- **替换** L1829+ 自写 header/布局 → canonical `MissionDetailFrame`。
- **重写** `handleWritingEvent`（L440-815，376 行 switch + emoji 文案）→ 改为 derive 投影 + canonical 消息组件，去 emoji（Lucide）。
- artifact tab：4 级优先级 useMemo 选源（versionOverride → view.writingArtifact → sibling 兜底 → 空态 placeholder）+ `isWritingArtifact` type guard。**性能关键**：artifact useMemo 依赖具体内容字段，**排除 `now`/tick**（防 markdown 树重渲闪烁）。
- **保留** 7-tab 结构 + 章节列表/世界观/故事圣经/导出 业务逻辑。

**改** `frontend/components/ai-writing/WritingTeamPanel.tsx`（547 行）

- 弃用 `missionMessage` 关键词推断（L49/L146/L168）→ 改吃 derive 出的 `AgentView/StageView`。
- 步骤条改用 canonical `StageStepper`；底部按钮去 emoji（▶🔄⏹ → Lucide `Play/RotateCw/Square`）。
- 保留已复用的 `TeamTopologyCanvas`。

**删除** `frontend/components/ai-writing/WritingCanvasView.tsx`（634 行 orphan，全仓无 import，自写 SVG canvas + emoji）。

**Artifact 渲染**：复用 playground `ArtifactReader` 模式（单 artifact prop 喂多视图）或为 writing 定制 Reader 消费 `WritingChapterListView/FullTextView/QualityReportView`。

### 4.5 UI 治理（标准 22）

- taskDetails 气泡（L3058）→ canonical `MissionTaskList`。
- export dropdown（L1924 自写浮层）→ canonical `Modal`/`ExportDialog`（已部分用）。
- toast（L1999 自写 fixed）→ `@/stores` 的 `toast`。
- 全页 emoji（🚀📐📚✍️🔍📝🌍📖▶🔄⏹）→ Lucide 图标。
- 改动前后跑 `npm run audit:ui-discipline`，**违规基线不得上涨**（未经批准）。

---

## 5. 分波建造顺序（buildWaves）

每波独立可验证，后端先行（前端依赖后端 endpoint + 事件契约）。

| Wave                            | 范围                                                                                                                                                                                                | Verify                                                                                                                                                             |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **W1 后端事件注册 + Socket 桥** | 新建 `writing.events.ts` + `writing.event-schemas.ts`；module onModuleInit `registerAll`；新建/改 gateway 注册 `SocketBroadcastAdapter` + join/leave 鉴权（按决策 A）；projector 补 `@Injectable()` | `npm run type-check`（backend）+ `npm run verify:arch`（facade 边界：DomainEventBus/SocketBroadcastAdapter 必须从 `ai-harness/facade` 导入）+ `npm run test:quick` |
| **W2 后端 Artifact REST**       | 新建 `writing-mission-read.controller.ts`（`GET writing/missions/:id/view`，走 projector 3 view）；可选 replay 端点 + MissionEventBuffer adapter                                                    | `npm run type-check` + `npm run verify:arch` + 手动 curl `/writing/missions/:id/view` 验证 envelope 形状                                                           |
| **W3 前端 WS/store**            | 新建 `useWritingStream` + `useWritingMissionView` + api 增 `writingReplay/getWritingMissionView`；store 移除实时态字段 + `pollMissionStatus`/`stepToPhase`/`activePollController`                   | `npm run type-check`（frontend）+ `npm run build:frontend`（确认 store 字段移除无残留引用）                                                                        |
| **W4 前端派生 + view 组件**     | `useWritingDerivedView` 接 `lib/missions/derive`；page 接 `MissionDetailFrame` + 双轨编排；`WritingTeamPanel` 改吃 `AgentView/StageView`；删 `WritingCanvasView.tsx`                                | `npm run type-check` + `npm run build:frontend` + `npm run lint`                                                                                                   |
| **W5 Artifact 渲染 + UI 治理**  | artifact 4 级选源 + type guard + Reader；emoji→Lucide；气泡/dropdown/toast→canonical                                                                                                                | `npm run build:frontend` + `npm run lint` + `npm run audit:ui-discipline`（基线不上涨）                                                                            |

> **前端无 E2E**：W3-W5 只能靠 `type-check + build:frontend + lint + audit:ui-discipline` 把关，加上 Railway URL 实际访问验证（CLAUDE.md「运行时验证」红线）。无法自动断言「事件正确渲染」，需人工在 live 页面观察一次完整 mission。

---

## 6. 风险（risks）

1. **老路降级**：legacy pipeline（`WRITING_PIPELINE_LEGACY`）仍发老事件（`mission:*`/`agent:working`/`chapter:*`/...），重构后新前端不再监听这些 → 老路页面实时进度退化为「空 + REST 兜底」。约束允许降级，但**必须验证老路不崩**：新 `useWritingStream` 在收不到 `writing.*` 事件时应优雅空态（不 throw、不白屏），`useWritingMissionView` 在 view 为空时显示 `EmptyState`。若决策 A1（改造旧 gateway），老路 project-room 推送会断，需确认老路是否已无活跃用户。

2. **live 生产页**：`ai-writing/[id]/page.tsx` 是 3901 行在线生产页，重构面巨大。建议**分支保护 + Railway 预览验证**，不可只靠本地 type-check。重点回归：章节列表/世界观/故事圣经/导出（保留的业务逻辑）不能因 store 字段迁移而连带破坏。store 移除 `missionProgress` 等字段时，**全仓 grep 所有引用点**，确认无遗漏（page 之外的组件可能也读了 store 实时字段）。

3. **UI 治理基线**：标准 22 要求 `audit:ui-discipline` 违规基线不上涨。本次删 emoji / 改 canonical 组件**应使基线下降**；若中途新增任何自写卡片/弹层（如 artifact Reader 若自写），需停下问用户批准。`MissionDetailFrame` 等 canonical 组件须确认对 writing 的 7-tab + 业务侧栏适配；不适配 → 停下问用户，不擅自新建公共组件。

4. **前端无 E2E 只能 build+type**：事件 type 字符串对齐（colon vs dot、前缀 `writing.`）、payload 字段名对齐是**运行时才暴露**的错误，type-check 抓不到。缓解：W1 后端 events schema 与 stage/relay 实际 emit 的 payload **逐字段对照测绘 ①**；前端 mirror type 直接从后端 `writing-artifact.projector.ts` 的 export 复制，不手写。playground 已有「event-emit-registry-coverage spec」断言「源码 emit 的每个 type literal 都注册了」——writing 照抄此 spec 可在 CI 拦截漏注册（强烈建议 W1 一并加）。

5. **DomainEventBus 校验 drop 静默**：未注册 type 被 drop + warn（不报错）。若 `writing.events.ts` 漏某个 topic 或 schema 与 payload 不符，事件**静默丢失**，前端表现为「某类事件永远收不到」。缓解：W1 加 registry-coverage spec + 后端 dev 环境观察 warn 日志。

6. **`writing.stage:degraded` 双 payload**：两个发射点两套 payload（3 字段 vs 7 字段），schema 必须 union，否则其一被校验 drop。前端 derive 也需 union 容纳。

---

## 7. 照抄落地清单（速查）

**后端 4 件**：

1. `events/writing.events.ts` + `event-schemas.ts`（列全 topic + zod，degraded 用 union）→ module onModuleInit `registerAll`。
2. gateway（按决策 A）：注入 `DomainEventBus`+`SocketBroadcastAdapter`+`MissionOwnershipRegistry`+`JwtService`+MissionStore+`CacheService`，`afterInit` 注册 adapter（prefix `"writing."`/room `"writing"`），join/leave 按 missionId + ownership + JWT。
3. `api/writing-mission-read.controller.ts`：`GET writing/missions/:id/view` 走 projector 3 view；可选 replay。
4. projector 补 `@Injectable()`；（建议）加 registry-coverage spec。

**前端 6 件**：

1. `useWritingStream.ts`（薄封装 `useMissionStream`）。
2. `useWritingMissionView.ts`（照 `useMissionDetailView`，coalescing/polling/abort 原样抄）。
3. `services/ai-writing/api.ts` 增 `writingReplay` + `getWritingMissionView`。
4. store 移除实时态 + `pollMissionStatus`/`stepToPhase`/`activePollController`，保留 CRUD。
5. `useWritingDerivedView.ts` 接 `lib/missions/derive`；page 双轨编排 + `MissionDetailFrame`；`WritingTeamPanel` 改吃 `AgentView/StageView`；删 `WritingCanvasView.tsx`。
6. artifact 4 级选源 + type guard + Reader；UI 治理（emoji→Lucide、气泡/dropdown/toast→canonical）。

**务必抄的坑**：直连 backendUrl 不走相对路径、`onAny` 不逐个监听、`useMemo` 排除 `now` 防闪、handshake 8s failsafe、WS 退化 `shouldPoll` 兜底、dedup key 含 payload 前缀、事件 type colon/dot 对齐、DomainEventBus 未注册 type 静默 drop。

---

## 8. 关键文件锚点

**后端**：

- 桥模板：`backend/src/modules/ai-app/playground/api/controller/agent-playground.gateway.ts:52-134`
- 事件注册模板：`backend/src/modules/ai-app/playground/events/agent-playground.events.ts` + `module/agent-playground.module.ts:285`
- view REST 模板：`backend/src/modules/ai-app/playground/api/controller/mission-read.controller.ts:95-107, 330-350`
- writing 待改：`ai-writing.gateway.ts:49-123`、`ai-writing.module.ts:288,326-376`、`ai-writing.controller.ts`、`mission/projectors/writing-artifact.projector.ts:37-209`

**前端**：

- WS 引擎：`frontend/hooks/features/useMissionStream.ts:18,24-54`
- view hook：`frontend/hooks/features/useMissionDetailView.ts`
- 派生：`frontend/hooks/features/useMissionLegacyView.ts`、`frontend/lib/missions/derive/index.ts`
- canonical 组件：`frontend/components/common/mission-detail/`（`MissionDetailFrame/StageStepper/RoleCard/MissionTaskList/MissionControlCard`）
- page 编排模板：`frontend/app/agent-playground/team/[missionId]/page.tsx:211,228`
- writing 待改：`frontend/hooks/features/useWritingWebSocket.ts`、`frontend/stores/ai-writing/aiWritingStore.ts:40-48,110,136-162,201-413`、`frontend/app/ai-writing/[id]/page.tsx:440-815,819-825,2027,2043`、`frontend/components/ai-writing/WritingTeamPanel.tsx:49,146,168`、`frontend/components/ai-writing/WritingCanvasView.tsx`（删）
