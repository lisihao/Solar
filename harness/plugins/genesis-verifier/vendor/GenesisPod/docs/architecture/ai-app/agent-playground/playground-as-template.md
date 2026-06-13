# Playground as Template — 新 Agent App 接入标杆

> **状态**：v1，2026-05-27 落地
> **定位**：playground 是当前生产 Agent App 形态的**事实标杆**（已被 radar / social 镜像复用）。本文是新 ai-app 接入的**单一入口**——汇总散在 9 份 playground doc 里的"必抄/选抄/别抄"判定。
> **作者**：Claude Code，基于 [agent-playground-target-boundary-and-directory-blueprint-2026-05-24.md](agent-playground-target-boundary-and-directory-blueprint-2026-05-24.md) 与实测 framework 引用矩阵
> **配套机器看护**：[backend/src/\_\_tests\_\_/architecture/layer-6-durability/playground-as-template.spec.ts](../../../../backend/src/__tests__/architecture/layer-6-durability/playground-as-template.spec.ts)

---

## 1. playground 是什么的标杆，不是什么的标杆

### ✅ **是标杆**（新 app 应当对照）

| 维度                        | 内容                                                                                                                                                |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **顶层目录布局**            | `module/ + api/ + runtime/ + mission/{pipeline,agents,projectors,lifecycle,query} + events/`                                                        |
| **mission 4 件套**          | pipeline（stages + dispatcher + orchestrator）+ projector（mission-view + todo-board）+ lifecycle（store + event-buffer + config-snapshot）+ agents |
| **Canonical view contract** | `MissionViewBase` re-export + `api/contracts/view-state.contract.ts` 形态                                                                           |
| **Framework 适配方式**      | hook-injection（extends + implement 4 个 protected method），不是猴子补丁                                                                           |
| **生产韧性**                | MissionRuntimeStateStore（Redis 心跳）+ MissionLivenessGuard + MissionTerminalArbiter（首写赢）+ MissionAbortRegistry                               |
| **预算治理**                | `ResolvedBudgetCaps.resolve()` 唯一处 + s1-budget 闸门 + maxCredits cap                                                                             |
| **测试比**                  | 110%（test LOC > src LOC）                                                                                                                          |
| **看护机制**                | ESLint `no-restricted-imports` + jest spec + pre-push hook 三层                                                                                     |

### ❌ **不是标杆**（新 app 不该照抄）

| 维度                                                | 不抄理由                                                                                                                                                                                                           |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **dynamic replan / Leader spawn-merge-cancel task** | playground 是 12-stage 线性 pipeline + 粗粒度 rerun，**不是** [30-sota](../../ai-harness/redesign/30-sota-task-centric-architecture.md) 设计的动态 replan。要这种能力看 topic-insights                             |
| **HITL editable state（pause → edit → resume）**    | playground 只有 pause/resume，没有 edit-after-pause。30-sota #9 尚未在 playground 落地                                                                                                                             |
| **"minimal viable" agent app**                      | 31K LOC + 7 agents + 36 event handler 不是 MVP 形态。要轻量参考看 `ask` (7K) 或 `simulation` (4K)                                                                                                                  |
| **todo-board projector 的复杂度**                   | playground override `project()` 因为有 parent-child DFS + reconciler-gap 锚位 5.5，**这是 Level 2 用法**。多数新 app 应该走 Level 1（完整用默认 project() + 4 hook）                                               |
| **UI 组件全套自建**                                 | playground 的 `components/agent-playground/ui/` 9 个原语（RoleChip / StatusPill / ToneCard 等）是 playground 业务专用，**不是** common 应该上提的。新 app 自己写业务 UI 原语 OK，但卡片/弹层/Tab/空态必须走 common |

---

## 2. Framework 适配矩阵（3 层 + 实测引用计数）

playground 共 extends / 用了 **17 个 BusinessTeam framework + 契约**。按"新 app 是否必须"分 3 层：

### Tier 1 · Core MUST（任何 mission app 必须用）

| Framework / 契约                                                   | playground | radar | social | 说明                                                   |
| ------------------------------------------------------------------ | :--------: | :---: | :----: | ------------------------------------------------------ |
| `BusinessTeamMissionDispatcherFramework`                           |     ✅     |  ✅   |   ✅   | mission run 入口 / sessions Map / abort 透传           |
| `BusinessTeamEventBufferFramework`                                 |     ✅     |  ✅   |   ✅   | 内存 FIFO + TTL + 事件持久化 hook                      |
| `BusinessTeamTodoBoardProjectorFramework`                          |     ✅     |  ✅   |   ✅   | todo-board projection plumbing（本次 2026-05-27 lift） |
| `MissionConfigSnapshot<T>` 契约                                    |     ✅     |  ✅   |   ✅   | 冻结 config + schemaVersion + 版本机制                 |
| `MissionViewBase*` 类型族                                          |     ✅     |  ✅   |   ✅   | canonical view contract base                           |
| `projectStagesByOrdinal()` helper                                  |     ✅     |  ✅   |   ✅   | stage projection 通用算法                              |
| `ResolvedBudgetCaps.resolve()`                                     |     ✅     |  ✅   |   ✅   | 预算换算唯一处                                         |
| `buildMissionCostView()` / `deriveSnapshotVersionFromRow()` helper |     ✅     |  ✅   |   ✅   | mission-view 通用 helper（本次 2026-05-27 lift）       |
| `MissionAbortRegistry`                                             |     ✅     |  ✅   |   ✅   | abort 信号注册表                                       |

**机器看护**：[canonical-view-pattern.spec.ts](../../../../backend/src/__tests__/architecture/layer-3-authority/canonical-view-pattern.spec.ts) I1-I6 + [playground-as-template.spec.ts](../../../../backend/src/__tests__/architecture/layer-6-durability/playground-as-template.spec.ts) Tier1。

### Tier 2 · Recommended WHEN（看场景按需）

| Framework                                   | playground | 适用场景                                                                                                                                              |
| ------------------------------------------- | :--------: | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BusinessTeamMissionStoreFramework`         |     ✅     | mission 有用户可见 CRUD（list/delete/visibility）。radar/social 不用是因为它们查的是自己的领域表（`radarRun` / `socialMission`），不是统一 mission 表 |
| `BusinessTeamLifecycleTransitionsFramework` |     ✅     | terminal 写仲裁分多种 outcome（completed / failed / cancelled / rejected）的场景。radar/social 自己实现 `MissionTerminalArbiter` 接口                 |
| `BusinessTeamUpdateHelperFramework`         |     ✅     | 用户可修改 mission 字段（重置 verdicts / 清理 dimensions 等）的场景                                                                                   |
| `MissionLifecycleManager`                   |     ✅     | mission 终态写入口需要统一仲裁的场景                                                                                                                  |
| `MissionLivenessGuard`                      |     ✅     | 多 pod 部署，需要孤儿 mission 扫描回收的场景                                                                                                          |
| `MissionRuntimeStateStore`（Redis 心跳）    |     ✅     | 多 pod 部署，需要 pod 互相接管 mission 的场景                                                                                                         |

### Tier 3 · Advanced（playground 独有，新 app 默认不要）

| Framework                                                                                                    | playground | 何时考虑                                          |
| ------------------------------------------------------------------------------------------------------------ | :--------: | ------------------------------------------------- |
| `BusinessTeamPostmortemHelperFramework`                                                                      |     ✅     | mission 复盘 + FailureLearner 接入                |
| `BusinessTeamReportHelperFramework`                                                                          |     ✅     | 报告版本化 + diff 追踪                            |
| `BusinessTeamCheckpointStoreFramework`                                                                       |     ✅     | mission 中途 crash 可断点续跑                     |
| `BusinessTeamCrossStageStateFramework`                                                                       |     ✅     | 跨 stage ad-hoc 状态容器（playground 有 14 字段） |
| `BusinessTeamMissionSpanFramework`                                                                           |     ✅     | OTel-native tracing 接入                          |
| `BusinessTeamRerunGuardFramework` + `ResumeRerunPolicyFramework` + `StageRerunDispatcherFramework`（5 件套） |     ✅     | 单 stage 级别 rerun（不是整 mission 重跑）        |

**默认不要**的理由：单消费方（仅 playground 在用），新 app 强行接会成为该 framework 的第 2 个 consumer——这会反向让 framework 接口被业务污染。等真有第二个需求出现时再让 framework 升级到 multi-consumer。

---

## 3. 跨 app 对比表（实测 LOC）

| 维度                       | playground |                       radar |  social |
| -------------------------- | ---------: | --------------------------: | ------: |
| 后端 src LOC               | **31,559** |                      11,074 |  22,352 |
| mission 模块 LOC           |     26,013 |                      ~6,500 | ~15,000 |
| 测试占源码比               |       110% |                        ~80% |    ~90% |
| mission-view.projector LOC |        598 |                         198 |     299 |
| todo-board.projector LOC   |  **1,739** |                          84 |     218 |
| pipeline LOC               |      9,963 |                       2,500 |   4,500 |
| agent class 数             |          7 | 0（algorithmic 不用 agent） |       9 |
| Tier 1 framework adoption  |        9/9 |                         9/9 |     9/9 |
| Tier 2 framework adoption  |        6/6 |                         0/6 |     0/6 |
| Tier 3 framework adoption  |        6/6 |                         0/6 |     0/6 |

**结论**：3 个 mission app 在 Tier 1 完全对齐；radar/social 选择在 Tier 2/3 自实现是合理简化，不是 framework 缺陷。

---

## 4. 新 Agent App 接入清单（机器可看护）

按顺序执行，每一步对应 spec 看护文件：

### 4.1 顶层布局（看 `agent-team-layout.spec.ts`）

```
backend/src/modules/ai-app/<your-app>/
├── module/                         # NestJS Module + onModuleInit
├── api/                            # Controllers + DTO + contracts/view-state.contract.ts
├── runtime/                        # *.config.ts + gateway + constants
├── events/                         # DomainEventRegistry 注册
└── mission/
    ├── pipeline/                   # stages/ + dispatcher + business-orchestrator
    ├── projectors/                 # mission-view + todo-board（必须 2 个）
    ├── lifecycle/                  # mission-store + event-buffer + config-snapshot
    ├── query/                      # mission-query.service.ts
    ├── agents/                     # role per dir + SKILL.md（可选，若有真 LLM agent）
    └── （可选）roles/ context/ chat/ export/ rerun/
```

### 4.2 Tier 1 framework 接入（看 `playground-as-template.spec.ts`）

- [ ] `mission/pipeline/<app>-pipeline-dispatcher.service.ts` extends `BusinessTeamMissionDispatcherFramework`
- [ ] `mission/lifecycle/<app>-event-buffer.service.ts` extends `BusinessTeamEventBufferFramework`
- [ ] `mission/projectors/<app>-todo-board.projector.ts` extends `BusinessTeamTodoBoardProjectorFramework`
- [ ] `mission/lifecycle/<app>-mission-config-snapshot.ts` 用 `MissionConfigSnapshot<TBusinessInput>` 类型
- [ ] `api/contracts/view-state.contract.ts` 从 facade re-export `MissionViewBase*`
- [ ] `mission/projectors/<app>-mission-view.projector.ts` 调 `projectStagesByOrdinal` + `buildMissionCostView` + `deriveSnapshotVersionFromRow`
- [ ] 全部 framework / contract import 走 `@/modules/ai-harness/facade`（不穿透内部路径）

### 4.3 Facade 边界守护（看 ESLint `no-restricted-imports`）

ESLint 自动拦截 `ai-app/**` 穿透 `ai-harness/teams/business-team/**` 内部路径的 import。新 app **必须**统一从 `@/modules/ai-harness/facade` 取符号。

### 4.4 测试要求

- [ ] 单元测试比 ≥ 80%（playground 标杆是 110%）
- [ ] todo-board projector 至少 1 个 fixture spec 覆盖：empty / pending / running / terminal 四个状态
- [ ] mission-view projector 覆盖 status mapping（completed → completed / failed → failed / etc）

---

## 5. Level 1 vs Level 2 项目分级（项目复杂度判定）

新 app 决定 todo-board projector 写法时：

| Level                          | 描述                                                                                                  | 走法                                                                                                                                                      |
| ------------------------------ | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Level 1（推荐）**            | stage 列表固定 + 业务事件 ≤ 5 类 + 无 fanout 或仅 1 维 fanout                                         | 完整用 `BusinessTeamTodoBoardProjectorFramework.project()` 默认流 + 实现 4 个 required hook + 0-2 个 optional hook（preAllocateExtras / sortKeyForExtra） |
| **Level 2（playground 形态）** | parent-child 树形 + 多 scope（system/dim/chapter/review/mission）+ 多锚位 sort key + 业务事件 ≥ 20 类 | override `project()` 自实现流程，但**必须**用 framework 的 utility（`this.upsert / this.evSuffix / this.getStepId / this.getString / this.getNumber`）    |

**判定**：默认 Level 1。只有当业务事件 ≥ 20 类**且**有 ≥ 3 scope 维度时才考虑 Level 2。Level 2 必须在 PR 描述里说明走这条路的原因。

---

## 6. 与已有 playground doc 的关系

| Doc                                                                      | 作用                               | 与本文关系                                                            |
| ------------------------------------------------------------------------ | ---------------------------------- | --------------------------------------------------------------------- |
| `agent-playground-target-boundary-and-directory-blueprint-2026-05-24.md` | 完整目录蓝图 + framework lift 状态 | **本文是它的"对外简化版"**，给新 app 作者用；它给 playground 维护者用 |
| `playground-dfx-assessment-2026-05-26.md`                                | 9 维 DFX 评估（A- 综合）           | 本文不重复评估，只引结论                                              |
| `agent-team-thinning-plan-2026-05-26.md`                                 | thinning 计划                      | 本文不涉及；thinning 是 playground 自身瘦身，不影响新 app             |
| `playground-multi-review-coverage-2026-05-26.md`                         | 多 reviewer 覆盖矩阵               | 本文不重复                                                            |
| `playground-read-model-and-frontend-thinning-plan-2026-05-25.md`         | 前端 thinning                      | 本文不涉及                                                            |
| `playground-cost-strategy-v1.md`                                         | 成本治理策略                       | 本文 §1 引用结论                                                      |
| `projector-framework-lift-plan.md`                                       | 本次 projector lift v1             | 本文 §2 Tier 1 包含其产物                                             |

---

## 7. 后续路线（不在本文范围）

| 议题                                     | 负责文档                                                                                                                 |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| dynamic replan / HITL editable state     | [30-sota-task-centric-architecture.md](../../ai-harness/redesign/30-sota-task-centric-architecture.md) by topic-insights |
| CLI scaffold（基于本文 §4 清单生成骨架） | [backlog-2026-05-27.md #2](../../../prd/backlog-2026-05-27.md)                                                           |
| writing app mission 对齐                 | 未排期；writing 当前异形态（services/mission/ 而非 mission/）                                                            |

---

**维护规则**：

- Tier 1/2/3 矩阵变化时**必须**同步本文 + spec test
- 新 framework 上提到 harness 时，先确认它属于哪一 Tier，再决定是否进矩阵
- "不是标杆"清单只能加不能减（除非真的落地了 dynamic replan / HITL 等）
