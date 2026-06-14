# StageRerunDispatcher — Per-Method Classification

**Status:** S1-4 deliverable(Stage 1,doc-only)— 为 Stage 2 split 决策提供事实依据。
**Source:** `backend/src/modules/ai-app/agent-playground/services/mission/rerun/stage-rerun.dispatcher.ts` (913 lines, analyzed at HEAD = `67c3f3935`).
**Date:** 2026-05-09.

---

## 1. 目的

Rev 5 boundary audit §3.3 + §7 S1-4 要求:在对 `stage-rerun.dispatcher.ts` 做任何 Stage 2 split 之前,**先按 method 分类 runtime cascade vs business patch**,产出书面依据。Rev 1 / 2 仅说"likely mixes",insufficient grounds for Stage 2 action;本文档替换为可逐行 audit 的分类。

分类标签:

- **`[runtime cascade]`** — 通用执行 mechanism,与 playground 业务字段无关;Stage 2 候选 lift 到 harness(目标 zone:Z3 BusinessAgentTeam framework 或 Z4 pipeline orchestrator)。
- **`[business patch]`** — 含 playground-specific 业务字段(如 `LEADER_VERDICT_AUTO_RERUN_RECOVERED`、s9b 评审 patch、specific stage handler implementation)— 必须留 `ai-app`。
- **`[mixed]`** — 含 generic mechanism + business adapter;Stage 2 内部拆分,把 mechanism 抽到 harness,adapter 留 app。

---

## 2. Per-Method Classification

| Line | Method                           | Category              | Responsibility                                                                                           |
| ---- | -------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------- |
| L190 | `dispatch(args)`                 | **[business patch]**  | Legacy scope 路由(`system:s9b` 10 维评审重跑实现)                                                        |
| L235 | `runFromStageWithCascade(args)`  | **[runtime cascade]** | Stage 按序链路执行器 + cascade chain runner(含 best-effort partial 失败处理)                             |
| L366 | `stepIndexOf(stepId)`            | **[runtime cascade]** | Pipeline step 索引查询(通用 mechanism)                                                                   |
| L374 | `emitCascadeAborted(...)`        | **[runtime cascade]** | Cascade 中止事件三元组发射(completed / abortedAt / remaining abstraction)                                |
| L416 | `makeStageHandler(runStage)`     | **[mixed]**           | 通用 stage handler 工厂(通用 ctx hydration + writeBack)+ 注册时绑定具体 stage 函数                       |
| L441 | `makeS6Handler()`                | **[mixed]**           | S6 Analyst 产物绑定(通用模式 + s6-specific output shape)                                                 |
| L464 | `makeS8Handler()`                | **[mixed]**           | S8 Writer 签名适配(通用模式 + s8-specific analyst / workspace 参数拼装)                                  |
| L509 | `handleS9bObjectiveEval(...)`    | **[business patch]**  | 10 维客观评审 + `LEADER_VERDICT_AUTO_RERUN_RECOVERED` patch(playground-specific 质量评分 + warning 管理) |
| L632 | `handleS11Persist(...)`          | **[business patch]**  | S11 持久化重跑 + `chapter_drafts` fallback recovery(playground-specific 错误恢复 + leaderVerdict patch)  |
| L781 | `rebuildArtifactFromDrafts(ctx)` | **[business patch]**  | Chapter draft 重建(playground c195035f mission fallback 路径,含降级哨兵 65 + `recoveryDegraded` flag)    |

**统计**:

- 3 个 `[runtime cascade]`(L235 / L366 / L374)
- 3 个 `[mixed]`(L416 / L441 / L464)
- 4 个 `[business patch]`(L190 / L509 / L632 / L781)

---

## 3. Stage 2 Split Plan

按上表分类得出的 split 计划 — **本文档不实施,仅作为 Stage 2 entry condition 满足后的 split 依据**。

### 3.1 Lift to harness(Stage 2,需 entry condition 1A 或 1B 满足)

| Method                          | 落点                                                           | 动作                                                                                                  |
| ------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `runFromStageWithCascade`(L235) | Z3 BusinessAgentTeam framework(新增 `CascadeRunner` 抽象)      | 提取 chain executor + best-effort partial + 失败 emit 三元组,业务方注入 stage handler registry        |
| `stepIndexOf`(L366)             | Z4 mission-pipeline-orchestrator(已有 `MissionPipelineConfig`) | 作为 `MissionPipelineConfig` 的 helper(`indexOfStep(steps, stepId): number` 静态方法)                 |
| `emitCascadeAborted`(L374)      | Z3(随 `CascadeRunner` 一起 lift)                               | 事件 type 字符串保留 `${eventNamespace}.cascade:aborted` 由 app adapter 注入,framework 不持业务字面量 |

### 3.2 Mixed:抽 mechanism 到 harness,留 adapter 在 app(Stage 2)

| Method             | mechanism 部分                                            | adapter 部分                                                          |
| ------------------ | --------------------------------------------------------- | --------------------------------------------------------------------- |
| `makeStageHandler` | 通用 `composeCtx → buildDeps → runStage → writeBackToCtx` | playground-specific `runStage` 函数引用(`runLeaderPlanStage` 等)      |
| `makeS6Handler`    | (复用上面 mechanism)                                      | s6-specific output shape `analystOutput` 写回 ctx                     |
| `makeS8Handler`    | (复用上面 mechanism)                                      | s8-specific 参数拼装(`analystOutput` / `outlinePlan` / `workspaceId`) |

抽 mechanism 候选名:`StageHandlerFactory`(Z3),签名:

```typescript
makeHandler<TArgs, TWriteback>(opts: {
  runStage: (args: TArgs) => Promise<TWriteback>;
  buildArgs: (ctx: HydratedMissionContext, deps: MissionDeps, session: RerunRuntimeSession) => TArgs;
  writeBack: (ctx: HydratedMissionContext, output: TWriteback) => HydratedMissionContext;
}): StageRerunHandler;
```

playground 在 app 侧调:

```typescript
const s6Handler = factory.makeHandler({
  runStage: runAnalystStage,
  buildArgs: (ctx, deps, session) => ({ ...session.bag, ctx, deps }),
  writeBack: (ctx, out) => ({ ...ctx, analystOutput: out.analystOutput }),
});
```

这样 mechanism(框架的"装配模板")在 harness,绑定(具体 runStage + 参数 + writeback)在 app。

### 3.3 Stay in app — 永不 lift

| Method                            | 留 app 原因                                                                                                      |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `dispatch`(L190)                  | legacy scope 路由 + system:s9b 10 维评审 — 业务-specific scope schema,与 v1.2 stepId 路径并存的兼容层,**不抽**   |
| `handleS9bObjectiveEval`(L509)    | 10 维评审权重 + `LEADER_VERDICT_AUTO_RERUN_RECOVERED` 字面量 + warning 管理 — 100% playground 业务规则           |
| `handleS11Persist`(L632)          | S11 持久化重跑路径,含 `chapter_drafts` fallback recovery + leaderVerdict patch — 100% playground 业务恢复策略    |
| `rebuildArtifactFromDrafts`(L781) | playground c195035f mission 专用 fallback,含降级哨兵 65 + `recoveryDegraded` flag — 100% playground 业务恢复路径 |

---

## 4. Stage 2 Entry Gate 与 lift 顺序

按 audit Rev 5 §7 Stage 2 entry conditions(1A 主路径 或 1B doc-anchored 兜底):

1. **第一批 lift**(low-risk,独立 method):`stepIndexOf` 移到 `MissionPipelineConfig` static helper — 单点 method,无 cascade 依赖,可独立 PR。
2. **第二批 lift**(中等):`runFromStageWithCascade` + `emitCascadeAborted` 一起 lift 到 Z3 `CascadeRunner` — 两者强耦合,同 PR。需要业务方 inject `eventNamespace` 与 stage handler registry。
3. **第三批 lift**(高复杂度):`makeStageHandler` / `makeS6Handler` / `makeS8Handler` mechanism 抽到 Z3 `StageHandlerFactory` — 需要泛型 + adapter 模式,需独立 ADR + 第二消费者(1A)或 doc-anchored(1B)入场。
4. **永不 lift**:`dispatch` / `handleS9bObjectiveEval` / `handleS11Persist` / `rebuildArtifactFromDrafts` 留 ai-app,在 audit acceptance criteria 里固化为业务边界。

---

## 5. 维护规则

- 本文档与 `stage-rerun.dispatcher.ts` 行号绑定。任何对该文件的重构(Stage 1 内部清理 / Stage 2 lift)必须**先更新本文档分类**,再做代码改动。
- Stage 2 任何一批 lift PR 提出时,必须显式引用本文档的对应表格行,作为 lift 落点的依据。
- 若发现新 method 加入 dispatcher,必须按"runtime / business / mixed"三选一标注,并在 §3 给 lift 计划。
- 本文档与 `docs/architecture/ai-app/agent-playground/agent-team-boundary-audit-2026-05-08.md` §3.3 + §7 S1-4 保持一致;若审计文档相关条目变更,本文档同步。
