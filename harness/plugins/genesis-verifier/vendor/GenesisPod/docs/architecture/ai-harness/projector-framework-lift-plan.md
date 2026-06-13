# Projector Framework Lift Plan

> 把 mission view projector 中的 **plumbing 部分**上提到 `ai-harness/teams/business-team/projectors/`，业务事件 handler 全留 app。
>
> **目标**：让每个 agent app 的 todo-board projector 从 ~250-1700 LOC 缩到 ~80-1580 LOC（plumbing 部分由 framework 提供），同时为 backlog #2 (CLI scaffold) 准备好可继承的基础。

---

## 1. 背景

### 1.1 现状摘要

4 个 ai-app 模块都实现了 mission 架构。其中 3 个（playground / radar / social）形态一致，writing 形态独立。

projector 层的 9 个文件，总计 4,276 LOC：

| App            | mission-view | todo-board | 其他（playground-only）                      |
| -------------- | -----------: | ---------: | -------------------------------------------- |
| **playground** |          605 |  **1,730** | agent-view 309, artifact 278, stage-view 240 |
| **social**     |          299 |        377 | —                                            |
| **radar**      |          197 |        241 | —                                            |

### 1.2 与既有 framework 的关系

harness 团队从 2026-05-08 PR-E0 开始陆续把 mission 架构的基础设施上提到 `ai-harness/teams/business-team/`：

| 已上提的 framework                                                        |  行数 | 三方使用情况                              |
| ------------------------------------------------------------------------- | ----: | ----------------------------------------- |
| `BusinessTeamMissionStoreFramework`                                       |   138 | playground / radar / social 都 extends ✅ |
| `BusinessTeamMissionDispatcherFramework`                                  |   192 | 三方都 extends ✅                         |
| `BusinessTeamEventBufferFramework`                                        |   146 | 三方都 extends ✅（薄壳 32-60 LOC）✅     |
| `BusinessTeamLifecycleTransitionsFramework`                               |   198 | 三方都 extends ✅                         |
| `BusinessTeamPostmortemHelperFramework`                                   |   136 | playground 用 ✅                          |
| `BusinessTeamReportHelperFramework`                                       |   112 | playground 用 ✅                          |
| `BusinessTeamUpdateHelperFramework`                                       |    84 | playground 用 ✅                          |
| `BusinessTeamCheckpointStoreFramework`                                    |   187 | playground 用 ✅                          |
| `BusinessTeamCrossStageStateFramework`                                    |    81 | playground 用 ✅                          |
| `BusinessTeamMissionSpanFramework`                                        |   178 | playground 用 ✅                          |
| `BusinessTeamRerunGuard/Orchestrator/Dispatcher/Policy/Builder` 等 5 件套 | 1,007 | playground 用 ✅                          |
| `MissionViewBase` 契约 + `projectStagesByOrdinal` helper                  |     — | 三方 mission-view 都用 ✅                 |

**已上提：mission lifecycle 全栈 + stage projection helper + canonical view base contract。**

**未上提（本计划目标）**：projector 内的 stage 生命周期 reducer + terminal cleanup + builder 工具 + anchor sort——这套 ~150 LOC 的 plumbing 在 3 个 todo-board projector 里**字节级重复**。

---

## 2. 决策范围（MECE）

| 候选物                                                                                                  | 是否上提                              | 理由                                                             |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------- |
| **todo-board projector 的 plumbing**                                                                    | ✅ **上提**                           | 三方字节级重复 + 已有 framework 摆放模式可复用                   |
| mission-view projector 顶层 shell                                                                       | ❌ 不抽 framework，加 2 个 helper     | shell 只 ~30 LOC，app-specific 字段占 60%，做 BaseClass 性价比低 |
| `buildMissionCostView(row)` / `deriveSnapshotVersionFromRow(row)`                                       | ✅ 加 2 个 pure helper                | 三方都有等价代码 ~15 LOC，纯函数最适合                           |
| mission-store / dispatcher / event-buffer / config-snapshot / lifecycle/update/postmortem/report helper | ❌ 已上提 framework，**不再二次抽象** | 业务语义渗透，差异是 by-design                                   |
| playground agent-view / artifact / stage-view projector                                                 | ❌ 不动                               | 单消费方，YAGNI                                                  |
| playground dag-view / rerun.dispatcher                                                                  | ❌ 暂不动                             | 单消费方，等第二个消费方出现                                     |
| stage 定义 / projector 业务事件 handler / Prisma 表名                                                   | ❌ 不动                               | 这些是 app 的本质                                                |

---

## 3. 框架设计

### 3.1 摆放位置

```
backend/src/modules/ai-harness/teams/business-team/projectors/
├── abstractions/
│   ├── todo-board-projector.contract.ts        # 类型契约
│   └── __tests__/
├── business-team-todo-board-projector.framework.ts   # ~200 LOC abstract class
└── __tests__/
    └── business-team-todo-board-projector.framework.spec.ts
```

**与现有 framework 摆放对齐**（`lifecycle/` `dispatcher/` `rerun/` `state/` 等同级）。`projectors/` 是新子目录，符合 `standards/16-ai-engine-harness-structure.md` MECE 原则——业界标准词，单一职责。

### 3.2 Framework 接口（基于实读 3 个 todo-board projector 共性提炼）

```typescript
// ── 契约 ──────────────────────────────────────────────────────────────
export interface BaseTodoBoardEntry {
  id: string;
  origin: string;
  scope: string;
  status: "pending" | "in_progress" | "done" | "failed";
  title: string;
  systemStageId?: string;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
}

export interface StagePreset {
  id: string;
  title: string;
  [extra: string]: unknown; // app 可挂 desc / role 等
}

export interface SourceEvent {
  type: string;
  payload: unknown;
  timestamp: number;
  agentId?: string;
}

export interface BuilderState<T> {
  todos: Map<string, T>;
  order: string[];
}

// ── Framework ─────────────────────────────────────────────────────────
export abstract class BusinessTeamTodoBoardProjectorFramework<
  TEntry extends BaseTodoBoardEntry,
  TRow extends { status: string; startedAt: Date | string | null },
  TSentinel,
> {
  // ── Required hooks ────────────────────────────────────────────────
  protected abstract systemStagePresets(): ReadonlyArray<StagePreset>;
  protected abstract makeSystemStageTodo(
    preset: StagePreset,
    ts: number,
  ): TEntry;
  protected abstract emptySentinel(): TSentinel;
  protected abstract loadedSentinel(items: TEntry[]): TSentinel;

  // ── Optional hooks（无默认实现 = no-op） ──────────────────────────
  /** 业务事件处理：返回 true 表示已消费，框架跳过后续匹配 */
  protected handleBusinessEvent?(
    state: BuilderState<TEntry>,
    ev: SourceEvent,
  ): boolean;
  /** 额外 todo 预分配（social: per-platform；radar: 无；playground: 无） */
  protected preAllocateExtras?(row: TRow, missionCreatedAt: number): TEntry[];
  /** 非 system stage 的 sort key（如 social platform 锚到 8.5） */
  protected sortKeyForExtra?(todo: TEntry): number;
  /** 终态状态映射（playground: rejected→done/finalized；其他: failed） */
  protected mapTerminalStatus?(rowStatus: string): "done" | "failed" | null;

  // ── Framework 提供 ─────────────────────────────────────────────────
  // 1. systemStagePresets 预分配（统一）
  // 2. stage:started / stage.started → todo upsert + status: pending → in_progress（字节级一致）
  // 3. stage:completed / stage.completed → status: done + endedAt（字节级一致）
  // 4. stage:failed / stage.failed → status: failed + endedAt（字节级一致）
  // 5. mission terminal cleanup（with mapTerminalStatus hook）
  // 6. anchor sort by STAGE_ORDINAL + createdAt（with sortKeyForExtra hook）
  // 7. builder utilities：upsert / makeBuilder / evSuffix / getStepId / getString / getNumber / getArray

  project(row: TRow | null, events: ReadonlyArray<SourceEvent>): TSentinel {
    /* ... */
  }
}
```

### 3.3 Mission-view helpers（轻量补充）

```typescript
// ai-harness/teams/business-team/abstractions/mission-view-helpers.ts

export function buildMissionCostView(row: {
  tokensUsed: bigint | number | null;
  costUsd: number | null;
  elapsedWallTimeMs: number | null;
  trajectoryStored?: unknown;
}): MissionCostView;

export function deriveSnapshotVersionFromRow(
  row: {
    lastCompletedStage?: number | null;
    completedAt?: Date | null;
    errorMessage?: string | null;
  },
  extras?: {
    extraInts?: Array<number | null | undefined>;
    extraFlags?: Array<unknown>;
  },
): number;
```

**不做 mission-view BaseClass 框架**——顶层 shell 太薄，纯函数 helper 即可。

---

## 4. 迁移序列

| 阶段     | 工作                                                                                               |     工时 | 风险 | 验收                                                |
| -------- | -------------------------------------------------------------------------------------------------- | -------: | ---- | --------------------------------------------------- |
| **A**    | 落 framework + 单元测 + 迁 **radar**（241 → ~80 LOC，只有 stage:\* 事件，无业务 handler）          |     1 天 | 极低 | radar projector spec 全绿 + 视图字节级一致          |
| **B**    | 迁 **social**（377 → ~150 LOC，验证 `preAllocateExtras` 支持 platform fanout + `sortKeyForExtra`） |   0.5 天 | 低   | social projector spec 全绿 + 视图字节级一致         |
| **C**    | 迁 **playground**（1,730 → ~1,580 LOC，36 个业务 handler 走 `handleBusinessEvent` hook）           |     1 天 | 中   | playground projector spec 全绿 + 前端视图行为零变化 |
| **D**    | 加 2 个 mission-view helper + 3 个 app 替换                                                        |   0.5 天 | 低   | 三方 mission-view spec 全绿                         |
| **总计** |                                                                                                    | **3 天** |      |                                                     |

### 回退策略

- **A 失败**（framework 接口不够灵活）：放弃，沉没成本 1 天，回到现状
- **B 失败**（hook 支持不足）：停在 A，radar 已优化，social/playground 不动
- **C 失败**（playground 36 handler 有些无法走 hook）：补 hook 字段，再回头看 A/B 是否要刷（应不需要，未用到的 hook 仍是 optional）

### 看护机制

完成后加一条架构 spec 测试（参考 `backend/src/__tests__/architecture/layer-boundaries.spec.ts` 模式）：

```typescript
// 任何 ai-app/**/projectors/*todo-board*.projector.ts 必须 extends BusinessTeamTodoBoardProjectorFramework
```

防止回潮。

---

## 5. 收益账目（诚实版）

### 5.1 现存 3 app 的 LOC 减少

| 文件                             |    今 | 上提后 |         减少 |
| -------------------------------- | ----: | -----: | -----------: |
| radar-todo-board.projector       |   241 |    ~80 |         -161 |
| social-todo-board.projector      |   377 |   ~150 |         -227 |
| playground/todo-board.projector  | 1,730 | ~1,580 |         -150 |
| 3 个 mission-view（helper 替换） |     — |      — |          -45 |
| harness 新增 framework + helpers |     0 |   ~250 |         +250 |
| **现存 3 app 净减少**            |       |        | **-333 LOC** |

**对现存 3 app 是小赢（~333 LOC）。**

### 5.2 真正的杠杆：新 app 边际成本

| App 类型     | 今天的 todo-board scaffold 成本 | 框架落地后 | 节省     |
| ------------ | ------------------------------: | ---------: | -------- |
| 新 agent app |                        ~250 LOC |   ~100 LOC | **-60%** |

**每多一个 agent app，节省持续累加。** 这是为 backlog #2 (CLI scaffold) 准备的前置条件——CLI 生成的 projector 必须是 framework 形态，否则 cargo-cult 会回潮。

---

## 6. 明确不做的事

> 顶住继续扩张的诱惑——这套规则与另一个 Agent "业务语义重，不建议上提"的判断在 store/dispatcher/helper 层是一致的。

| 不做                                                                 | 理由                                                                            |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 抽 `MissionViewProjectorFramework` BaseClass                         | shell 只 30 LOC，间接层增加 > 收益                                              |
| 二次抽象 mission-store / dispatcher / event-buffer / config-snapshot | 三方都已经 extends framework，再抽就是过度抽象（业务语义在 app 内是 by-design） |
| 抽 playground 独有的 agent-view / artifact / stage-view projector    | 1 个消费方，YAGNI                                                               |
| 抽 playground dag-view (694 LOC) / rerun.dispatcher (741 LOC)        | 1 个消费方，等第二个消费方出现                                                  |
| 提取业务事件 handler 到共享库                                        | dimension fanout / chapter pipeline / platform publishing 都是 app 的本质       |
| 改 stage 定义 / Prisma 表名 / api/contracts shape                    | 不在本计划范围                                                                  |

---

## 7. 风险与不确定性

### 7.1 已知风险

| 风险                                                                                                         | 影响                           | 缓解                                                               |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------ | ------------------------------------------------------------------ |
| Phase C 时 playground 36 个 handler 中有些无法走 `handleBusinessEvent` hook                                  | 框架接口要二次设计             | 通过 Phase A/B 提前暴露接口；hook 设计 optional 即可向后兼容补字段 |
| stage:started/completed/failed handler 细节差异（如 status 仅 pending → in_progress 才更新，已 done 不回退） | 字节级一致测试可能失败         | 已在框架 spec 覆盖：状态机只前进不回退                             |
| 终态映射在 playground "rejected"→"done/finalized" vs 其他 app→"failed"                                       | 行为差异                       | `mapTerminalStatus` hook 解决                                      |
| 跨 app 的视图 schema 已经分化（TodoBoardEntry shape 不同）                                                   | 框架泛型 `<TEntry>` 必须够灵活 | 泛型 + 约束 `extends BaseTodoBoardEntry`                           |

### 7.2 仍不确定的事

- **playground 1730 LOC 中 36 个 handler 是否真的全部都是业务**——我读了入口 dispatch 和前 250 行，没逐行读完。Phase C 时可能发现 1-2 个 handler 其实是 plumbing（如 `event:dropped` `event:oversized` `iteration:progress` 这类 diagnostic 事件）。这部分如果发现，作为 Phase E 补充上提

---

## 8. 后续路线（不在本计划范围，仅备忘）

| 候选                                     | 触发条件                                                                                                                                                              |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 抽 dag-view framework                    | 第二个 app 需要 dag 视图（如 social/radar 后续支持复杂依赖）                                                                                                          |
| 抽 rerun.dispatcher framework            | 第二个 app 需要 stage rerun（已有 `BusinessTeamStageRerunDispatcherFramework` 235 LOC，但 playground 还是自己写了 741 LOC——这部分需要单独看是不是没充分用 framework） |
| 抽 diagnostic event handler 到 framework | Phase C 完成后回顾，确认 budget warning / event dropped 是否真的跨 app 通用                                                                                           |
| Mission-view BaseClass framework         | 出现第 4 个 mission app 且 shell 字段开始重复时                                                                                                                       |

---

## 9. 拍板事项

- [ ] **总工时 3 天可接受？** 如只能给 1 天，仅做 Phase A 作可行性证明
- [ ] **Framework 放 `ai-harness/teams/business-team/projectors/` 对吗？**
- [ ] **现在开工 还是 等 backlog #2 (CLI) 启动一起做？** 建议现在做（CLI 的前置条件）
- [ ] **完成后是否加架构 spec 看护**（防回潮）？建议加

---

## 10. 索引

| 相关文档                          | 链接                                                                                                       |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 来源 backlog                      | [docs/prd/backlog-2026-05-27.md](../../prd/backlog-2026-05-27.md)                                          |
| AI Harness MECE 结构规范          | [standards/16-ai-engine-harness-structure.md](../../../standards/16-ai-engine-harness-structure.md)        |
| 架构边界 spec                     | `backend/src/__tests__/architecture/layer-boundaries.spec.ts`                                              |
| 现存 todo-board projector         | `backend/src/modules/ai-app/{agent-playground,radar,social}/mission/projectors/*-todo-board.projector.ts`  |
| 现存 mission-view projector       | `backend/src/modules/ai-app/{agent-playground,radar,social}/mission/projectors/*mission-view.projector.ts` |
| 现存 framework（`BusinessTeam*`） | `backend/src/modules/ai-harness/teams/business-team/`                                                      |
| Canonical view contract           | `backend/src/modules/ai-harness/teams/business-team/abstractions/mission-view-base.contract.ts`            |
| Stage ordinal helper              | `backend/src/modules/ai-harness/teams/business-team/abstractions/stage-ordinal-projection.util.ts`         |

---

**创建日期**：2026-05-27
**作者**：Claude Code（基于实读 4,276 LOC projector + 3,635 LOC framework 实证分析）
**状态**：草案，待拍板
**估计工时**：3 天（4 阶段，每阶段独立可回退）
**修订记录**：

- v1（仅 LOC + 文件名推断）：估算上提收益 1,780 LOC，方案覆盖 mission-view + todo-board + 部分 helper → **已废弃**
- v2（基于实读）：收益修正为 ~333 LOC（现存 3 app）+ 60% 边际节省（每新 app），范围聚焦 todo-board framework + 2 个 helper
