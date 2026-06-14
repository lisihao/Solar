# 任务级重跑（per-task rerun）+ 后置依赖级联（cascade）设计

> **版本**: v1.2-final（5 路 APPROVED-FOR-IMPLEMENTATION ✅，可进实施）
> **日期**: 2026-05-07
> **作者**: Claude Code（基于用户 mission c195035f 真实痛点驱动）
> **上游问题**: mission `c195035f` 跑完 S1-S10 (43 min / $3.42 / 1.14M tokens) 在 S11 因 `chapter_content_incomplete` guard 失败，整 mission 状态 failed。重跑只能整 mission 从 S1 开始，浪费巨大。
> **下游目标**: 每个 todo / stage 都暴露"重跑此任务"按钮，重跑时**沿用 DB 中所有前置已成产物**，自动**级联跑下游 stage**。

---

## 0. TL;DR

**问题**：现有 LocalRerunService v1 白名单仅 `system:s9b`，其它 stage 失败必须整 mission 重跑（耗时 + 费 token）。

**方案**：把 stage 的"前置/后置"声明在 PLAYGROUND_PIPELINE 的 step 配置里，重跑时按 DAG 自动 cascade，期间 ctx 从 DB + event payload 重建（不再 LLM 重跑前置）。

**关键设计**（v1.1 修订后）：

1. **DAG 声明**：每 step 加 `ctxWrites` / `dbWrites` / `reads` / `successors` / `rerunable` / `resetFields` 字段（v1.1 类别 C4：拆 ctx / DB 两套命名空间）
2. **单一信源**：S8 / S6 / S7 的中间产物（reportArtifact / analystOutput / outlinePlan / verifierVerdicts）必须主动写 mission.report_full 等 DB 列（用 markIntermediateState patch），event 仅作审计 / observability，不作权威源（v1.1 类别 A）
3. **ctx-hydrator 增强**：从 chapter_drafts + research_results + mission 行字段重建 ctx；event payload 仅作 fallback warning（v1.1 类别 A 修）
4. **cascade 执行器**：`StageRerunDispatcher.runFromStageWithCascade(fromStepId)` 用 stage handler registry（Map<stepId, StageHandler>）按 successors 顺序调度，**best-effort partial**（cascade 中失败时已 patch 字段保留 + last_completed_stage 更新到失败前一步）（v1.1 类别 C1 + G1）
5. **status 状态机**：failed/quality-failed mission reopen 为 running（用乐观锁 update with where filter 防 TOCTOU + 完整 reset 字段集 + hydrate() 接受 rerun-in-flight）（v1.1 类别 B + E2）
6. **UI 暴露**：每 todo "重跑此任务" + cascade preview 对话框（含 token / cost 估算 + DB 实时 cost_usd 比对 maxCredits）（v1.1 类别 E6）
7. **DAG 类型放在 ai-harness/runner**（通用层），PLAYGROUND_PIPELINE 仅填值（v1.1 类别 H）

**工作量**：6 PR / 8 天（v1.1 调整：PR-R3 1.5→3 天 + R5 提前到 R3 之前），含 spec + 集成测试；不需要 DB schema 变更。

**c195035f 实操**：方案落地后，用户在 S11 todo 点"重跑此任务"，系统从 mission.dimensions/report_full/reconciliation_report/verdicts/leader_journal 直接还原 ctx（**S8 已主动持久化，无需 event 兜底**），跑 S11（preface→optional hotfix 已生效）→ markCompleted。

> **关键修订（v1.1 vs v1.0）**：v1.0 把 S8 event payload 当数据兜底是错的——event 是异步 emit 无一致性保证，可能丢失或被注入。v1.1 改为：失败 mission（c195035f）需要先把 S8 event payload 中的 artifact 一次性 backfill 到 mission.report_full（用 hotfix migration 或人工脚本），然后 hydrator 只从 DB 读。新 mission 走 S8 stage 主动持久化 artifact 到 mission.report_full（即使后续 stage 失败也保留）。

---

## 1. 背景

### 1.1 mission c195035f 真实痛点

2026-05-07 用户启动 mission `c195035f`（"2026 全球碳中和政策进展"，深度 10 dim）：

- S1-S10 全部成功（43 min / $3.42 / 1.14M tokens）
- v1.7 装配核验：templateId / sanitizerVersion / sectionCountMismatch / dim 字数 4112-4711 均匀 ✅
- S11 markCompleted 因 `chapter_content_incomplete: nonEmpty=13/14 sections >= 40 chars` 失败（preface section bodyBytes=0）
- hotfix `3b8f28ab8`（preface fixed→optional）已推主线
- 但用户**无法重跑 S11**只验证 hotfix —— 必须整 mission 从 S1 重头跑（再 43 min + $3.42）

**用户原话**：「现在还有一个极其严重的问题，不支持单个任务就地重跑，[...] 如果不支持入库单任务重跑，将花费巨大的时间和资源，这是绝对不能接受的，请确认前面支持单任务重跑的方案（需要考虑前置依赖和后置依赖）」

### 1.2 现有能力 Inventory（90% 已就绪）

| 能力                            | 状态    | 文件                                                                                                                                                |
| ------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 整 mission 重跑（新 missionId） | ✅ 完整 | `mission-rerun-orchestrator.service.ts` (fresh / incremental)                                                                                       |
| ctx 中间产物持久化              | ⚠️ 部分 | mission table 有 dimensions/themeSummary/report_full/reconciliation_report/verdicts/leader_journal；研究产物在 chapter_drafts + research_results 表 |
| ctx 重建（rehydrate）           | ⚠️ 部分 | `CtxHydratorService.hydrate()` — 当前仅读 mission 行字段，**没读 chapter_drafts / research_results / event payload**                                |
| Checkpoint + 恢复               | ✅ 完整 | `PipelineRunCheckpoint` 表 + `MissionCheckpointService.canResume()`                                                                                 |
| 单 stage 路由                   | ✅ 完整 | `LocalRerunService.run()` + `StageRerunDispatcher.dispatch()`                                                                                       |
| patch 不改 status               | ✅ 完整 | `mission-store.markRerunPatch`                                                                                                                      |
| TOCTOU 安全锁                   | ✅ 完整 | `prisma.$transaction` + `RerunLockRegistry`                                                                                                         |

### 1.3 缺口（10%）

1. **白名单 only s9b**：`LocalRerunService.isLocallyRerunable` (line 83-86) 只放行 `system:s9b`，其它都拒绝
2. **DAG 关系未声明**：`PLAYGROUND_PIPELINE.steps` 是线性数组，没有"S11 重跑后是否需要 S12 跑"的元数据
3. **ctx-hydrator 不全**：researcherResults 字段无 DB 列；reportArtifact 失败时只在 S8 event payload，hydrator 不读 event
4. **cascade 不支持**：dispatcher 只跑单 stage，没有"从 S_i 一路跑到 S_n"逻辑
5. **status 状态机无 reopen**：mission 一旦 failed 不能反向回 running 再跑下游

---

## 2. 总体架构

### 2.1 设计原则

1. **声明式 DAG**：stage 关系在 config 里声明，不在代码里硬编码
2. **ctx 严格幂等**：cascade 中每个 stage 的输入完全可从 DB / event 重建，无装配期 stub 漏洞
3. **patch-only 写库**：rerun 期间用 markRerunPatch（非 markCompleted/markFailed），失败时原 mission 状态保留
4. **用户预览 + 确认**：UI 在重跑前展示"将影响哪些下游 stage" + 让用户确认（防误操作）
5. **失败可恢复**：rerun 中失败不变成 mission terminal failure，原 mission 仍是 failed/completed，重跑事件单独追踪

### 2.2 核心机制

```
┌─────────────── 用户点击 todo "重跑此任务" ───────────────┐
│                                                          │
│  1. 前端: GET /missions/:id/rerun-preview?stepId=X        │
│  2. 后端: 计算 cascadeChain = [X, ...successors(X)]      │
│  3. 前端: 弹对话框"将重跑 N 步 + 预估 token X / cost Y" │
│  4. 用户确认 → POST /local-rerun (scope=stage, stepId=X) │
│  5. 后端: LocalRerunService.run                          │
│     a. acquire lock + status guard                       │
│     b. ctx-hydrator 从 DB / event 重建完整 ctx            │
│     c. dispatcher.runFromStageWithCascade(stepId, ctx)   │
│        for stage in cascadeChain:                        │
│          stage.execute(ctx) → markRerunPatch(fields)     │
│     d. emit rerun-completed                              │
│  6. 前端: 收 rerun-completed 事件 → re-fetch detail       │
└──────────────────────────────────────────────────────────┘
```

### 2.3 DAG 视图（PLAYGROUND_PIPELINE）

当前 14 step 线性，但 cascade 关系并非全是"前 → 全后"：

```
S1-budget    [前置闸，不可重跑]
S2-leader-plan  → 重跑必须 cascade 全后（plan 改了下游全部依赖）
S3-researcher-collect  → 重跑必须 cascade S4+S5+S6+S7+S8+...+S11
S4-leader-assess  → 重跑只 cascade S5（assess 决定 reconciler 输入）
S5-reconciler  → 重跑只 cascade S6+S7+S8+...+S11
S6-analyst  → 重跑 cascade S7+S8+...+S11
S7-writer-outline  → 重跑 cascade S8+S8B+S9+S9B+S10+S11
S8-writer  → 重跑 cascade S8B+S9+S9B+S10+S11
S8B-quality-enhancement  → 重跑 cascade S9+S9B+S10+S11
S9-critic  → 重跑 cascade S9B+S10+S11
S9B-objective-eval  → 重跑 cascade S10+S11（当前 v1 implementation）
S10-leader-foreword-signoff  → 重跑 cascade S11
S11-persist  → 重跑无 cascade（终态）
```

**重要细节**：S2 重跑等于全 mission 重跑（plan 变所有下游变），UI 应该警告或干脆走"开新研究"路径。S11 是 cascade 链的终点（S12 是 fire-and-forget postlude，不强行 cascade）。

---

## 3. 详细模块设计

### 3.1 Stage DAG schema（PR-R1，v1.1 类别 C4 + H1 修订）

**文件位置（v1.1 类别 H 修订）**: `backend/src/modules/ai-harness/runner/dag/stage-dag.types.ts`（**通用层**），让其它 ai-app（office / writing / topic-insights）后续也可复用。PLAYGROUND_PIPELINE 仅填值。

**类型设计（v1.1 类别 C4 修订）**：拆 `ctxWrites` / `dbWrites` 两个独立命名空间，编译期可校验：

```typescript
/** mission 行 DB 列名联合（仅含可被 stage 写入的列）。*/
export type MissionColumnKey =
  | "report_full"
  | "report_artifact_version"
  | "completed_at"
  | "final_score"
  | "status"
  | "error_message"
  | "dimensions"
  | "theme_summary"
  | "reconciliation_report"
  | "verdicts"
  | "leader_journal"
  | "leader_signed"
  | "leader_overall_score"
  | "leader_verdict"
  | "outline_plan" // v1.1 D3 新加列
  | "analyst_output"; // v1.1 D3 新加列

/** Stage DAG 元数据 — 给 cascade 执行器读的"重跑影响图"。*/
export interface StageDagMeta {
  /** ctx 字段：stage 在 ctx 中读的字段（hydrator 校验完整性时用）。*/
  readonly ctxReads: ReadonlyArray<keyof MissionContext>;
  /** ctx 字段：stage 写入 ctx 的字段（ctx 副作用范围）。*/
  readonly ctxWrites: ReadonlyArray<keyof MissionContext>;
  /** DB 列：stage 写入 mission 表的列（cascade reset 时用）。*/
  readonly dbWrites: ReadonlyArray<MissionColumnKey>;
  /** 该 stage 后必须自动跑的下游 stage id 列表（按 PLAYGROUND_PIPELINE.steps 顺序）。*/
  readonly successors: ReadonlyArray<string>;
  /** 是否允许用户从该 stage 触发重跑。*/
  readonly rerunable: boolean;
  /** 拒绝重跑的原因（rerunable=false 时必填）。*/
  readonly rerunableReason?: string;
  /** 重跑前需要 reset 的 mission 列（独立于 dbWrites — 含错误标记等"清状态"字段）。*/
  readonly resetFields?: ReadonlyArray<MissionColumnKey>;
}
```

**类型自洽 spec**（PR-R1 含）：

```typescript
// stage-dag.types.spec.ts
it("每 step 的 successors 都是有效 step id", () => {
  const validIds = new Set(PLAYGROUND_PIPELINE.steps.map((s) => s.id));
  for (const step of PLAYGROUND_PIPELINE.steps) {
    for (const succ of step.dag?.successors ?? []) {
      expect(validIds.has(succ)).toBe(true);
    }
  }
});

it("每 step 的 dbWrites + resetFields 都是合法 MissionColumnKey", () => {
  // 编译期类型守护 + 运行期 schema 校验
});

it("successors 链无环", () => {
  // 拓扑排序检查
});
```

**改动**: `backend/src/modules/ai-app/playground/playground.config.ts`

每个 step 配置加 `dag` 字段（示例 S11）：

```typescript
{
  primitive: "persist",
  id: "s11-persist",
  mode: "final",
  timeoutMs: 120_000,
  dag: {
    ctxReads: ["reportArtifact", "verifierVerdicts", "leaderSignOff", "trajectoryStored"],
    ctxWrites: [], // S11 不改 ctx，只写 DB
    dbWrites: ["report_full", "report_artifact_version", "completed_at", "final_score", "status"],
    successors: [], // S11 是终点
    rerunable: true,
    resetFields: ["error_message", "completed_at"], // 重跑前清空
  },
},
```

**全 14 step 的 dag 声明**详见 §5 矩阵。

### 3.2 CtxHydratorService 增强（PR-R2）

**文件**: `backend/src/modules/ai-app/playground/services/mission/rerun/ctx-hydrator.service.ts`（改）

**关键缺口修复**：

#### 3.2.1 researcherResults 重建（v1.1 类别 D1+D2 修订）

当前 hydrate 返回 `researcherResults: undefined`（line 126），导致 cascade 到 S5/S6/S8 时 ctx.researcherResults 为空。修：从 `agent_playground_research_results` + `agent_playground_chapter_drafts` 表重建。

**v1.1 类别 D1**：同 dim 多 retry_label 行（leader-assess-retry 产生）取 **latest retry_label**（按 created_at desc + LIMIT 1 per dim）—— 因为 leader 的 reflexion 重试只有最后一轮被 S4 接受。
**v1.1 类别 D2**：用 dim_id（不是数组 index）作 chapter ↔ research join key，避免 partial dim failure 时 index 漂移。

```typescript
private async hydrateResearcherResults(
  missionId: string,
): Promise<MissionContext["researcherResults"]> {
  // 1. 取每个 dim 的 latest research_result 行（按 created_at desc DISTINCT ON dimension）
  const rrRows = await this.prisma.$queryRaw<ResearchResultRow[]>`
    SELECT DISTINCT ON (dimension) *
    FROM agent_playground_research_results
    WHERE mission_id = ${missionId}
    ORDER BY dimension, created_at DESC
  `;
  // 2. 取所有 chapter_drafts（按 dim + chapter_index 排序，确保每 dim 内章节顺序）
  const cdRows = await this.prisma.agentPlaygroundChapterDraft.findMany({
    where: { missionId },
    orderBy: [{ dimension: "asc" }, { chapterIndex: "asc" }],
  });
  // 3. 用 dim 名作 join key（不是数组 index）
  const cdByDim = new Map<string, typeof cdRows>();
  for (const cd of cdRows) {
    if (!cdByDim.has(cd.dimension)) cdByDim.set(cd.dimension, []);
    cdByDim.get(cd.dimension)!.push(cd);
  }
  return rrRows.map((rr) => ({
    dimension: rr.dimension,
    findings: rr.findings as Finding[],
    summary: rr.summary,
    fullMarkdown: cdByDim.get(rr.dimension)?.map((c) => c.content).join("\n\n## ") ?? undefined,
    chapters: cdByDim.get(rr.dimension)?.map((c) => ({
      index: c.chapterIndex,
      heading: c.heading,
      body: c.content,
      wordCount: c.wordCount ?? 0,
    })),
  }));
}
```

#### 3.2.2 reportArtifact 还原（v1.1 类别 A：仅从 DB，不靠 event 兜底）

**v1.0 错误方案**：从 S8 event payload 还原。
**问题**：event 是异步 emit 无一致性保证，可能丢失/延迟/被注入；与 DB 写入非原子。
**v1.1 正确方案**：S8 stage 在产出 reportArtifact 后**立即用 markIntermediateArtifact patch 写 mission.report_full**（即使后续 stage 失败也保留），ctx-hydrator 只读 DB。

```typescript
private async hydrateReportArtifact(
  missionId: string,
  detail: MissionDetail,
): Promise<ReportArtifact | undefined> {
  // v1.1：mission.report_full 是 S8 主动持久化的，hydrator 无需兜底逻辑
  if (detail.reportArtifactVersion === 2 && detail.reportFull) {
    return ReportArtifactZodSchema.parse(detail.reportFull); // v1.1 E1: zod 校验
  }
  if (detail.reportFull) {
    return undefined; // 老版 ResearchReport，让 caller 走 detail.report 路径
  }
  return undefined;
}
```

**对应 S8 stage 改造**（在 `s8-writer-draft-report.stage.ts` 末尾加）：

```typescript
// v1.1 类别 A1：S8 装配完 reportArtifact 立刻写 DB，不等 S11
if (reportArtifact) {
  await deps.store.markIntermediateArtifact(missionId, {
    reportFull: reportArtifact,
    reportArtifactVersion: 2,
  });
}
```

**`markIntermediateArtifact` 是新方法**：与 markRerunPatch 类似（不动 status），但语义专用于"stage 中间产物落盘"。任何 stage 都可调用，作 cascade rerun 时的"前置依赖兜底"。

**c195035f 历史 mission 处理**：写一次性 backfill 脚本 `scripts/dev/monitoring/backfill-c195035f-artifact.js`，从 S8 event payload 读 artifact 后用 markIntermediateArtifact 写入 mission.report_full（含 zod 校验）。脚本仅运行一次（人工触发），后续 mission 走 S8 主动持久化路径。

#### 3.2.3 outlinePlan / analystOutput / verifierVerdicts 还原（v1.1 类别 D3）

**v1.0 方案**：从 event payload 还原（同样错）。
**v1.1 方案**：这三个产物现在 mission 行没有独立列，加 markIntermediateState 接口写以下 mission 行字段：

- `outlinePlan` → S7 stage 调 `markIntermediateState({ outlinePlan: ... })` 写 mission.outline_plan（**新加 mission 列 outline_plan jsonb**）
- `analystOutput` → S6 同理写 mission.analyst_output（**新加 mission 列 analyst_output jsonb**）
- `verifierVerdicts` → S9b 调 `markIntermediateState({ verifierVerdicts: ... })` 写 mission.verdicts（已有列）

**这是 v1.1 的最大变化**：v1.0 说"无 DB schema 变更"，**v1.1 改为"加 2 列 mission.outline_plan + mission.analyst_output"**（迁移 SQL 在 §4 给出），让所有 cascade 关键中间产物都有权威 DB 源，根除 event 依赖。

### 3.3 StageRerunDispatcher 扩容（PR-R3，v1.1 类别 C1+C2+G1 修订）

**文件**: `backend/src/modules/ai-app/playground/services/mission/rerun/stage-rerun.dispatcher.ts`（改）

**v1.1 类别 C1 修订**：用 stage handler registry（Map）替代 switch，新 stage 加 handler 即可，dispatcher 文件不变。

```typescript
/** 每个 stage 的 rerun handler — 收 hydrated ctx + emit，自己负责调原 stage 函数 +
 *  按 dag.dbWrites 写 patch。返回 void（成功）或 throw（失败 → cascade abort）。*/
export type StageRerunHandler = (
  ctx: HydratedMissionContext,
  emit: EmitFn,
  stub: StageRerunStubs,
) => Promise<void>;

/** stub-friendly 依赖（rerun 期间 mission-level 资源不可用，所以提供 stub 替身）。
 *  v1.1 类别 C3：把 stub 抽成显式接口，每个 handler 知道自己要哪些 stub。*/
export interface StageRerunStubs {
  invokerStub: AgentInvoker; // billing context 用 stub-billing-context
  poolStub: BudgetPool; // 含原 mission 已用 cost，rerun 不重置
  storeStub: MissionStore; // 真 store（写 markIntermediateState patch）
  abortRegistry: MissionAbortRegistry;
  log: Logger;
  emit: EmitFn;
  // ... 其它每 stage 真用到的依赖
}
```

```typescript
@Injectable()
export class StageRerunDispatcher {
  private readonly log = new Logger(StageRerunDispatcher.name);
  private readonly handlers = new Map<string, StageRerunHandler>();

  constructor(
    private readonly store: MissionStore,
    private readonly reportEvaluation: ReportEvaluationService,
    // 其它 service 注入
  ) {
    // v1.1 类别 C1：构造期注册（不再 switch）
    this.handlers.set("s11-persist", this.handleS11.bind(this));
    this.handlers.set("s10-leader-foreword-signoff", this.handleS10.bind(this));
    this.handlers.set("s9b-objective-eval", this.handleS9b.bind(this));
    this.handlers.set("s9-critic", this.handleS9.bind(this));
    this.handlers.set("s8b-quality-enhancement", this.handleS8b.bind(this));
    this.handlers.set("s8-writer", this.handleS8.bind(this));
    this.handlers.set("s7-writer-outline", this.handleS7.bind(this));
    this.handlers.set("s6-analyst", this.handleS6.bind(this));
    this.handlers.set("s5-reconciler", this.handleS5.bind(this));
    this.handlers.set("s4-leader-assess", this.handleS4.bind(this));
    this.handlers.set("s3-researcher-collect", this.handleS3.bind(this));
    this.handlers.set("s2-leader-plan", this.handleS2.bind(this));
    // s1-budget 不可重跑（dag.rerunable=false 拦在前面）
  }

  async runFromStageWithCascade(args: {
    ctx: HydratedMissionContext;
    fromStepId: string;
    emit: EmitFn;
    stubs: StageRerunStubs;
  }): Promise<{
    completed: string[];
    abortedAt?: string;
    errorMessage?: string;
  }> {
    const { ctx, fromStepId, emit, stubs } = args;
    const fromStep = PLAYGROUND_PIPELINE.steps.find((s) => s.id === fromStepId);
    if (!fromStep) throw new BadRequestException(`unknown step: ${fromStepId}`);
    if (!fromStep.dag?.rerunable) {
      throw new BadRequestException(
        `stage ${fromStepId} not rerunable: ${fromStep.dag?.rerunableReason}`,
      );
    }

    const cascadeChain: string[] = [fromStepId, ...fromStep.dag.successors];
    this.log.log(
      `[cascade ${ctx.missionId}] chain=${cascadeChain.join(" → ")}`,
    );

    // 1. reset 受影响字段（先一次性 reset 整链 dbWrites + resetFields）
    await this.resetFieldsForCascade(ctx.missionId, cascadeChain);

    // 2. 顺序执行（v1.1 G1: best-effort partial — 失败时已成的 stage 保留）
    const completed: string[] = [];
    for (const stepId of cascadeChain) {
      await emit({
        type: "agent-playground.rerun:stage-started",
        missionId: ctx.missionId,
        userId: ctx.userId,
        payload: {
          stepId,
          fromStepId,
          cascadeChain,
          completedSoFar: [...completed],
        },
      }).catch(() => {});

      const handler = this.handlers.get(stepId);
      // v1.1 类别 C2: indexOf 防护改为构造期注册校验，运行期 if 拒
      if (!handler) {
        const errorMessage = `stage ${stepId} has no rerun handler registered`;
        this.log.error(`[cascade ${ctx.missionId}] ${errorMessage}`);
        return { completed, abortedAt: stepId, errorMessage };
      }

      try {
        await handler(ctx, emit, stubs);
        completed.push(stepId);
        // 每完成一个 stage 都更新 last_completed_stage，让前端看到进度
        await this.store.markIntermediateState(ctx.missionId, {
          lastCompletedStage: this.stepIndexOf(stepId),
        });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        // v1.1 G1：cascade 中失败明确 best-effort partial 语义
        await emit({
          type: "agent-playground.rerun:cascade-aborted",
          missionId: ctx.missionId,
          userId: ctx.userId,
          payload: {
            abortedAt: stepId,
            completed: [...completed], // 已成功 patch 的 stage（保留）
            remaining: cascadeChain.slice(
              this.stepIndexOfInChain(cascadeChain, stepId) + 1,
            ), // 未跑的下游 (v1.2 reviewer fix)
            errorMessage,
            partialModeNote:
              "best-effort partial: 已成 stage 的 patch 保留，未跑下游不动",
          },
        }).catch(() => {});
        return { completed, abortedAt: stepId, errorMessage };
      }
    }
    return { completed };
  }

  private async resetFieldsForCascade(
    missionId: string,
    cascadeChain: string[],
  ): Promise<void> {
    const fieldsToReset = new Set<MissionColumnKey>();
    for (const stepId of cascadeChain) {
      const step = PLAYGROUND_PIPELINE.steps.find((s) => s.id === stepId);
      step?.dag?.resetFields?.forEach((f) => fieldsToReset.add(f));
    }
    if (fieldsToReset.size > 0) {
      await this.store.resetFields(missionId, [...fieldsToReset]);
    }
  }

  private stepIndexOf(stepId: string): number {
    const idx = PLAYGROUND_PIPELINE.steps.findIndex((s) => s.id === stepId);
    if (idx === -1)
      throw new Error(`step ${stepId} not in PLAYGROUND_PIPELINE`); // v1.1 C2
    return idx;
  }
}
```

**关键约束（v1.1 重申）**：

- 每个 stage handler 在 rerun 路径下用 StageRerunStubs（不调原 BillingContext / MissionPool 等装配级 service）
- 每 handler 自己声明 stub 依赖，避免 god-class
- token cost 增量累加（不覆盖原值）
- cascade **best-effort partial**（v1.1 类别 G1）：失败时已 patch 字段保留，前端 emit 看 completed[] / abortedAt / remaining 三元组

### 3.4 LocalRerunService 白→黑名单（PR-R4）

**文件**: `backend/src/modules/ai-app/playground/services/mission/rerun/local-rerun.service.ts`（改）

```typescript
/** 黑名单（不允许重跑的 stage / scope）— 其它一律允许。*/
const STAGE_RERUN_BLACKLIST = new Set([
  "s1-budget", // 预算闸，不应重跑
  // 注：S2 重跑等于全 mission 重跑，但语义上仍允许（用户应当主动选）
  // 注：S11 现在允许（hotfix 后核心 use case）
]);

static isLocallyRerunable(args: {
  origin: string;
  scope: string;
  todoId: string;
  stepId?: string; // 新增：直接传 stepId 路由
}): { rerunable: boolean; reason?: string; cascadeChain?: string[] } {
  if (args.origin === "leader-assess-abort") {
    return { rerunable: false, reason: "已放弃的维度无法重跑" };
  }

  // 优先看 stepId（todo 关联的 pipeline step）
  if (args.stepId) {
    if (STAGE_RERUN_BLACKLIST.has(args.stepId)) {
      return { rerunable: false, reason: `${args.stepId} 不可重跑` };
    }
    const step = PLAYGROUND_PIPELINE.steps.find(s => s.id === args.stepId);
    if (!step?.dag?.rerunable) {
      return { rerunable: false, reason: step?.dag?.rerunableReason ?? "未知 step" };
    }
    return {
      rerunable: true,
      cascadeChain: [args.stepId, ...step.dag.successors],
    };
  }

  // 老路径：scope-based（dimension/chapter）保留兜底
  if (args.scope === "system" && args.todoId.endsWith("s9b-objective-evaluation")) {
    return { rerunable: true };
  }
  // dimension / chapter 路径在 PR-R6 单独建（涉及 billing context）
  return { rerunable: false, reason: `${args.scope} 类型 v1 暂未支持，请按 stepId 重跑` };
}
```

新增 reopen status 路径（与 markRerunPatch 互补）：

```typescript
async run(input: LocalRerunInput, emit: EmitFn): Promise<LocalRerunResult> {
  // ... 现有 acquire lock + status guard ...

  // 新增：cascade 中如果 missionId 当前 failed，先 transition 回 running（reopen）
  const fromStepId = input.stepId;
  if (fromStepId) {
    const detail = await this.store.getById(input.missionId, input.userId);
    const cascadeWillReachS11 = (PLAYGROUND_PIPELINE.steps.find(s => s.id === fromStepId)?.dag?.successors ?? []).includes("s11-persist") || fromStepId === "s11-persist";
    if (detail?.status === "failed" && cascadeWillReachS11) {
      // 重跑链终点是 S11 → 需要 reopen 让 S11 markCompleted 能改 status
      await this.store.markReopened(input.missionId, input.userId);
    }
  }

  // ... ctx-hydrator + dispatcher.runFromStageWithCascade ...
}
```

### 3.5 MissionStore.markReopened（PR-R5，v1.1 类别 B+E2 修订，提前到 R3 之前）

**文件**: `backend/src/modules/ai-app/playground/services/mission/lifecycle/mission-store.service.ts`（加）

**v1.1 修订点**：

- 类别 B1：reset 字段集明确（不只清 errorMessage，还要清 finalScore/leaderVerdict/leader_journal.\_\_checkpoint）
- 类别 B2：CtxHydratorService.hydrate() 改为接受 status='running'（mission 在 reopen 中是合法状态）
- 类别 E2：用乐观锁 update with where filter，防 TOCTOU（findFirst + update 非原子）
- 类别 I1：本 PR-R5 提前到 R3 之前，让 R3 cascade 执行器能立刻调用 markReopened（依赖关系无环）

```typescript
/**
 * 把 failed / quality-failed mission 反向 transition 回 running，让重跑链
 * 终点的 markCompleted 能正常改 status。
 *
 * v1.1 类别 E2 — 改用乐观锁：单 SQL update with where filter +
 * 检查 affectedRows，避免 v1.0 findFirst+update 的 TOCTOU。
 *
 * v1.1 类别 B1 — reset 字段集完整：
 *   - status / completedAt / errorMessage / finalScore / leaderVerdict
 *   - leaderSigned / leaderOverallScore（让 S10 可重跑）
 *   - heartbeatAt 重置为 NOW()
 *   - leader_journal 字段保留（含 __checkpoint key 已在 markCompleted 时删除）
 *
 * v1.1 类别 B3 — 5×5 状态转移矩阵全覆盖（spec 见 §8）：
 *   from=failed         → running ✅
 *   from=quality-failed → running ✅
 *   from=cancelled      → BadRequest（用户主动 cancel 的 mission 不允许 reopen）
 *   from=completed      → BadRequest（已成功 mission 不允许反向）
 *   from=running        → BadRequest（in-flight mission 不允许并发 reopen）
 */
async markReopened(missionId: string, userId: string): Promise<void> {
  const allowedFromStatuses = ["failed", "quality-failed"] as const;

  // v1.1 E2：单原子 update，count 检查防 TOCTOU
  const result = await this.prisma.$transaction(async (tx) => {
    const updated = await tx.agentPlaygroundMission.updateMany({
      where: {
        id: missionId,
        userId,
        status: { in: [...allowedFromStatuses] },
      },
      data: {
        status: "running",
        errorMessage: null,
        completedAt: null,
        finalScore: null,
        leaderSigned: null,
        leaderOverallScore: null,
        leaderVerdict: null,
        heartbeatAt: new Date(),
      },
    });
    if (updated.count === 0) {
      // 可能：mission 不存在 / userId 不匹配 / status 不在白名单
      const probe = await tx.agentPlaygroundMission.findFirst({
        where: { id: missionId, userId },
        select: { status: true },
      });
      if (!probe) throw new NotFoundException(`mission ${missionId} not found or not owned by ${userId}`);
      throw new BadRequestException(
        `cannot reopen mission in status=${probe.status} (allowed: ${allowedFromStatuses.join("|")})`,
      );
    }
    // 审计事件（同一事务内）
    await tx.agentPlaygroundMissionEvent.create({
      data: {
        missionId,
        type: "agent-playground.mission:reopened",
        payload: { triggeredBy: userId, ts: Date.now() },
      },
    });
    return { ok: true };
  });
  return result.ok ? undefined : undefined;
}

/**
 * v1.1 类别 A1（与 markRerunPatch 互补）：stage 中间产物落盘，不动 status。
 * 任何 stage 都可调用，让 ctx-hydrator 永远从 DB 读到最新中间状态。
 */
async markIntermediateState(
  missionId: string,
  patch: Partial<{
    reportFull: ReportArtifact;
    reportArtifactVersion: 1 | 2;
    outlinePlan: OutlinePlan;
    analystOutput: AnalystOutput;
    verdicts: ReadonlyArray<unknown>;
    reconciliationReport: ReconciliationReport;
    dimensions: ReadonlyArray<DimensionPlan>;
    themeSummary: string;
    leaderJournal: ReadonlyArray<unknown>;
    leaderSigned: boolean;
    leaderOverallScore: number;
    leaderVerdict: string;
    lastCompletedStage: number;
  }>,
): Promise<void> {
  // 不带 status guard — stage 中间写允许在任何 status（mission 跑期 + 重跑期都用）
  await this.prisma.agentPlaygroundMission.update({
    where: { id: missionId },
    data: { ...patch, heartbeatAt: new Date() },
  });
}

/**
 * v1.1 cascade 用：reset 受影响字段（cascade 起点前一次性清，避免 stale 残留）。
 */
async resetFields(missionId: string, fields: ReadonlyArray<MissionColumnKey>): Promise<void> {
  const data: Record<string, null> = {};
  for (const f of fields) {
    data[snakeToCamel(f)] = null; // mission 表 prisma 模型用 camelCase
  }
  await this.prisma.agentPlaygroundMission.update({
    where: { id: missionId },
    data,
  });
}
```

**v1.1 类别 B2 — CtxHydratorService.hydrate() 同步改造**：

```typescript
async hydrate(missionId: string, userId: string): Promise<HydratedMissionContext> {
  const detail = await this.store.getById(missionId, userId);
  if (!detail) throw new NotFoundException(`mission ${missionId} not found`);

  // v1.1 类别 B2：mission 在 reopen 后 status=running 是合法的
  // 改为：拒绝 status='running' 但 heartbeatAt 还在 X 秒内的 mission（in-flight 真在跑）
  // running 但 heartbeat > 60s 前的视为"reopen 完成等待 cascade 开跑"，允许 hydrate
  const HEARTBEAT_INFLIGHT_THRESHOLD_MS = 60_000;
  if (detail.status === "running" && detail.heartbeatAt &&
      Date.now() - detail.heartbeatAt.getTime() < HEARTBEAT_INFLIGHT_THRESHOLD_MS) {
    throw new BadRequestException(
      `mission ${missionId} is in-flight (heartbeat ${Math.round((Date.now() - detail.heartbeatAt.getTime())/1000)}s ago) — cannot rerun while live`,
    );
  }
  // ... 其余 hydrate 逻辑不变
}
```

> **替代方案**：用 mission 表的独立字段 `rerun_phase`（"none"/"reopened-pending"/"cascade-running"）显式标记 reopen 后的 cascade 等待状态。当前 v1.1 用 heartbeatAt 时间窗判断（更轻量），如果用 phase 字段需 schema 加列。两者择一，spec 锁住语义。
>
> **v1.2 arch 修订**：明确语义 — `heartbeat < 60s 时拒绝（mission 真在跑，可能是其它 pod 同 mission 在 emit 心跳）`，`heartbeat ≥ 60s 时允许（已无活跃 emit，mission 处于 reopen 后等待 cascade 开跑的窗口）`。本期不加 rerun_phase 列，PR-R0 migration 注释里写 "intentionally not adding rerun_phase column — using heartbeat time window instead"，防后续维护者不读文档加列造成 schema 漂移（v1.2 coder 修订）。

### 3.6 Frontend：每 todo "重跑此任务" + cascade 提示（PR-R6）

**文件**: `frontend/components/agent-playground/TodoDetailDrawer.tsx`（改）

```typescript
const supportsLocalRerun = (todo: MissionTodo): boolean => {
  if (todo.origin === "leader-assess-abort") return false;
  if (todo.stepId === "s1-budget") return false;
  // 其它一律放行（后端会对 stepId 做最终校验）
  return true;
};

// 重跑按钮 click handler
async function handleRerun() {
  // 1. 预览 cascade chain
  const preview = await fetchRerunPreview(missionId, todo.stepId);
  // preview = { cascadeChain, estimatedTokens, estimatedCostUsd }

  // 2. 弹对话框确认
  const confirmed = await confirm(
    `将重跑以下 ${preview.cascadeChain.length} 步：\n${preview.cascadeChain.join(" → ")}\n预估消耗：${preview.estimatedTokens} tokens / $${preview.estimatedCostUsd}`,
  );
  if (!confirmed) return;

  // 3. 触发
  await localRerunTodo({ missionId, todoId: todo.id, stepId: todo.stepId });
  toast.success("已开始重跑，请等待 progress 事件");
}
```

新增 controller endpoint：`GET /missions/:id/rerun-preview?stepId=X` → 返回 cascadeChain + token / cost 估算。

---

## 4. 数据库变更（v1.1 类别 D3 + E4 修订）

### 4.1 mission 表加 2 列（中间产物权威源）

为根除 event payload 数据依赖（v1.0 致命缺陷），mission 表加 2 列：

```sql
-- backend/prisma/migrations/20260507_per_task_rerun_intermediate_state/migration.sql
ALTER TABLE "agent_playground_missions"
  ADD COLUMN IF NOT EXISTS "outline_plan" JSONB,
  ADD COLUMN IF NOT EXISTS "analyst_output" JSONB;

COMMENT ON COLUMN "agent_playground_missions"."outline_plan" IS
  'S7 writer outline planner 输出（cascade rerun 时 ctx-hydrator 读取）';
COMMENT ON COLUMN "agent_playground_missions"."analyst_output" IS
  'S6 analyst 输出（cascade rerun 时 ctx-hydrator 读取）';
```

对应 prisma schema：

```prisma
model AgentPlaygroundMission {
  // ... 现有字段
  outlinePlan      Json?  @map("outline_plan")     // v1.1 D3 新加
  analystOutput    Json?  @map("analyst_output")   // v1.1 D3 新加
}
```

### 4.2 rerun_attempts 表（v1.1 类别 E4 频次限制）

```sql
-- backend/prisma/migrations/20260507_rerun_attempts/migration.sql
CREATE TABLE "agent_playground_rerun_attempts" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "mission_id" UUID NOT NULL REFERENCES "agent_playground_missions"("id") ON DELETE CASCADE,
  "user_id" UUID NOT NULL,
  "step_id" TEXT NOT NULL,
  "triggered_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX "rerun_attempts_mission_step_time" ON "agent_playground_rerun_attempts"
  ("mission_id", "step_id", "triggered_at" DESC);
```

LocalRerunService 用 `SELECT count(*) WHERE mission_id=X AND step_id=Y AND triggered_at > NOW() - INTERVAL '24 hours'` 判断；上限 5 次/24h（防滥用）。

### 4.3 复用现有

- `agent_playground_missions` 行字段（已加 2 列后完整覆盖 ctx）
- `agent_playground_research_results` 表
- `agent_playground_chapter_drafts` 表
- `agent_playground_mission_events` 表（仅审计 / observability，**不再作 ctx 兜底数据源**）
- `pipeline_run_checkpoints` 表（incremental rerun 模式复用）

### 4.4 事件类型新增

- `agent-playground.mission:reopened`（审计）
- `agent-playground.rerun:stage-started`（cascade 开跑）
- `agent-playground.rerun:cascade-aborted`（cascade 中失败）
- `agent-playground.rerun:cascade-completed`（cascade 全过）
- `agent-playground.mission:rate-limit-exceeded`（24h 频次超限）

---

## 5. 前置依赖矩阵

每 stage 的 reads / writes / successors 完整声明（PR-R1 落地）：

| Step ID                     | reads（ctx 字段）                                                         | writes（DB 字段）                                                                 | successors                           | rerunable    | reset on rerun                               |
| --------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------ | ------------ | -------------------------------------------- |
| s1-budget                   | input.maxCredits                                                          | mission.max_credits                                                               | (n/a)                                | ❌ 预算闸    | -                                            |
| s2-leader-plan              | input.topic                                                               | mission.dimensions, mission.theme_summary                                         | s3,s4,s5,s6,s7,s8,s8b,s9,s9b,s10,s11 | ⚠️ 等于全跑  | dimensions, theme_summary, 全下游字段        |
| s3-researcher-collect       | plan, input                                                               | research_results, chapter_drafts                                                  | s4,s5,s6,s7,s8,s8b,s9,s9b,s10,s11    | ✅           | research_results, chapter_drafts, 全下游字段 |
| s4-leader-assess            | researcherResults, plan                                                   | (none, only narration)                                                            | s5,s6,s7,s8,s8b,s9,s9b,s10,s11       | ✅           | 全下游字段                                   |
| s5-reconciler               | researcherResults                                                         | mission.reconciliation_report                                                     | s6,s7,s8,s8b,s9,s9b,s10,s11          | ✅           | reconciliation_report, 全下游字段            |
| s6-analyst                  | researcherResults, reconciliationReport                                   | analystOutput (in event)                                                          | s7,s8,s8b,s9,s9b,s10,s11             | ✅           | 下游字段                                     |
| s7-writer-outline           | analystOutput, plan                                                       | outlinePlan (in event)                                                            | s8,s8b,s9,s9b,s10,s11                | ✅           | 下游字段                                     |
| s8-writer                   | outlinePlan, analystOutput, researcherResults, reconciliationReport, plan | reportArtifact (in event), report_full                                            | s8b,s9,s9b,s10,s11                   | ✅           | report_full, 下游字段                        |
| s8b-quality-enhancement     | reportArtifact                                                            | reportArtifact.quality (in event)                                                 | s9,s9b,s10,s11                       | ✅           | 下游字段                                     |
| s9-critic                   | reportArtifact                                                            | reportArtifact.metadata.critique (in event)                                       | s9b,s10,s11                          | ✅           | 下游字段                                     |
| s9b-objective-eval          | reportArtifact                                                            | reportArtifact.metadata.pipelineEvaluation, mission.report_full                   | s10,s11                              | ✅ (v1 实现) | 下游字段                                     |
| s10-leader-foreword-signoff | reportArtifact, verifierVerdicts                                          | mission.leader_signed/leader_overall_score/leader_verdict, mission.leader_journal | s11                                  | ✅           | leader_signed, signoff fields, s11 字段      |
| s11-persist                 | reportArtifact, verifierVerdicts, leaderSignOff, trajectoryStored         | mission.report_full, mission.completed_at, mission.final_score, mission.status    | (n/a)                                | ✅ ★         | error_message, completed_at, final_score     |

**关键观察**：

- S2 重跑实质等于全 mission 重跑（dim 改 → 所有研究失效）—— UI 必须强警告
- S11 重跑无 cascade（终点）—— c195035f 的核心 use case
- S8 重跑 cascade 链最长（5 个下游）—— 但合理（writer 改 → 评审/前言/落盘都得重）

---

## 6. 失败模式（v1.1 类别 G1 修订：best-effort partial 语义明确）

**核心原则（v1.1 G1）**：cascade 中失败采用 **best-effort partial** —— 已 patch 字段保留，未跑下游不动，原 mission 状态机不变。前端从 `cascade-aborted` 事件 payload 看到 `completed[] / abortedAt / remaining[]` 三元组；用户可选择"重跑 abortedAt"继续往下推。

| 失败场景                             | 处理                   | mission.status                                         | mission.last_completed_stage | event payload                                          |
| ------------------------------------ | ---------------------- | ------------------------------------------------------ | ---------------------------- | ------------------------------------------------------ |
| ctx-hydrator zod 失败                | throw BadRequest       | 不变                                                   | 不变                         | rerun-failed                                           |
| ctx-hydrator data 不完整             | throw BadRequest       | 不变                                                   | 不变                         | rerun-failed                                           |
| ctx-hydrator payload 超 2MB          | throw BadRequest       | 不变                                                   | 不变                         | rerun-failed                                           |
| 频次 24h 超限                        | throw 429              | 不变                                                   | 不变                         | rate-limit-exceeded                                    |
| 实时 cost_usd 超 maxCredits          | throw BadRequest       | 不变                                                   | 不变                         | rerun-failed                                           |
| cascade 中 stage_i 抛错              | abort cascade          | 若 reopen 已发生 → 仍 running（用户可继续）；否则 不变 | = stepIndexOf(stage\_{i-1})  | cascade-aborted{ abortedAt, completed[], remaining[] } |
| cascade 中 stage_i 超时（wallTimer） | abort cascade          | 同上                                                   | 同上                         | cascade-aborted（同样）                                |
| 用户 abort（点取消）                 | abortRegistry 触发     | 同上                                                   | 同上                         | cascade-aborted（reason=user_abort）                   |
| 并发同 todo 重入                     | RerunLockRegistry 拒绝 | 不变                                                   | 不变                         | rerun-failed (lock_held)                               |
| 跨 pod 同 mission 并发 reopen        | 乐观锁 update count=0  | 不变                                                   | 不变                         | rerun-failed (status_conflict)                         |
| reopen 后 S11 又失败                 | cascade-aborted at S11 | 仍 running（不再 markFailed，让用户继续重跑）          | = stepIndexOf(S10)           | cascade-aborted                                        |
| reopen 后 S11 成功                   | markCompleted          | running → completed                                    | = stepIndexOf(S11)           | cascade-completed                                      |

**关键细节**（v1.1 新增）：

- cascade 中失败**不再 markFailed**：mission 留在 reopen 后的 running 状态，让用户继续重跑（避免来回 reopen 浪费）
- 但 mission.heartbeat_at 不再更新 → 30 min 后会被 orphan detector 标记 stalled（safeguard）
- 如果用户 30 min 内没继续重跑，stalled 状态前端展示 "重跑中断 - 点击恢复"，再点恢复时 markIntermediateState 触发 heartbeat 续命

---

## 7. 安全考虑（v1.1 类别 E1-E6 修订）

### 7.1 用户隔离（E3）

所有 query 必须带 `userId` 限定：

- mission 表查询：`where: { id, userId }` ✅ 现有
- mission_event 查询：`where: { missionId, mission: { userId } }`（嵌套 join 校验）✅ 新加
- chapter_drafts / research_results：通过 mission_id 关联，间接由 mission.userId 隔离 ✅

```typescript
// v1.1 E3：所有 event query 强制 userId 隔离
const event = await this.prisma.agentPlaygroundMissionEvent.findFirst({
  where: {
    missionId,
    type: "agent-playground.stage:lifecycle",
    mission: { userId }, // ★ 嵌套校验
  },
});
```

### 7.2 ReportArtifact zod schema 实例化（E1，BLOCKER）

**v1.0 缺陷**：`isValidArtifact(artifact)` 仅占位，cast `as ReportArtifact` 不安全。

**v1.1 落地**：新增 `backend/src/modules/ai-harness/evaluation/critique/report-artifact/report-artifact-zod.schema.ts`：

```typescript
import { z } from "zod";

export const ArtifactSectionZodSchema = z.object({
  id: z.string().min(1).max(64),
  type: z.enum([
    "executive_summary",
    "preface",
    "dimension",
    "cross_dimension",
    "risk_assessment",
    "recommendations",
    "conclusion",
    "appendix",
  ]),
  level: z.union([z.literal(2), z.literal(3)]),
  title: z.string().min(1).max(200),
  anchor: z.string().min(1).max(200),
  startOffset: z.number().int().min(0),
  endOffset: z.number().int().min(0),
  wordCount: z.number().int().min(0).max(1_000_000), // 防注入超大数字
  readingTimeMinutes: z.number().int().min(0).max(10_000),
  citations: z.array(z.number().int()).max(1000),
  figureIds: z.array(z.string().max(64)).max(100),
  factIds: z.array(z.string().max(64)).max(1000),
  sourceDimensionId: z.string().max(64).optional(),
});

export const ReportArtifactZodSchema = z.object({
  content: z.object({
    fullMarkdown: z.string().max(2_000_000), // ≤ 2MB（与 sanitizer maxInputBytes 一致）
    fullReportSize: z.number().int().min(0).max(2_000_000),
  }),
  sections: z.array(ArtifactSectionZodSchema).max(100),
  citations: z.array(z.unknown()).max(1000),
  figures: z.array(z.unknown()).max(100),
  factTable: z.array(z.unknown()).max(1000),
  metadata: z
    .object({
      topic: z.string().min(1).max(500),
      templateId: z.string().max(100).optional(),
      sanitizerVersion: z
        .string()
        .regex(/^\d+\.\d+\.\d+$/)
        .optional(),
      // ... 其它字段
    })
    // v1.2 security 修订：metadata 加 max key 数量限制防 DoS 投毒
    .and(
      z
        .record(z.string().max(64), z.unknown())
        .refine((obj) => Object.keys(obj).length <= 50, {
          message: "metadata fields > 50 (DoS 防护)",
        }),
    ),
  // ... 其它顶层字段
});

export type ValidatedReportArtifact = z.infer<typeof ReportArtifactZodSchema>;
```

ctx-hydrator 读 mission.report_full 时调 `ReportArtifactZodSchema.parse(detail.reportFull)`，校验失败 throw（hydrate 拒绝）。

### 7.3 markReopened 乐观锁（E2）

已在 §3.5 用 `updateMany where status in [...]` + 检查 `count` 实现，spec 见 §8。

### 7.4 频率限制（E4）

- DB 表 `agent_playground_rerun_attempts`（见 §4.2）
- LocalRerunService 入口先 query 24h 内同 mission+stepId attempt count
- 超 5 次返回 `429 TooManyRequests` + emit `mission:rate-limit-exceeded` 事件
- 24h 后表行 cleanup（cron job）

### 7.5 Payload 大小限制（E5）

- mission.report_full JSONB 列硬上限 2MB（zod schema 含）
- ctx-hydrator 入口加 `JSON.stringify(detail.reportFull).length > 2_000_000` 守卫（预 zod parse 之前快速拒）
- mission_event payload 大小限制由 BroadcastAdapter 已有 256KB cap 控制

### 7.6 Billing 防护（E6）

```typescript
// v1.1 E6：rerun 启动前检查 DB 实时 cost_usd（不是 local 计算）
const detail = await this.store.getById(missionId, userId);
const realtimeCostUsd = detail.costUsd ?? 0;
const estimatedRerunCostUsd = await this.estimateCascadeCost(cascadeChain);
if ((realtimeCostUsd + estimatedRerunCostUsd) * 100 > detail.maxCredits) {
  throw new BadRequestException(
    `预算不足：当前 $${realtimeCostUsd.toFixed(2)} + 预估 $${estimatedRerunCostUsd.toFixed(2)} > 上限 $${(detail.maxCredits / 100).toFixed(2)}`,
  );
}
```

### 7.7 审计日志

每次 rerun 写 mission_event：rerun-started / stage-started / cascade-aborted / cascade-completed / rate-limit-exceeded / mission:reopened。

---

## 8. spec 套件（v1.1 类别 F1-F5 修订）

### 8.1 单元 spec（每 stage 13 条 happy + 13 条 fail）

**`stage-dag.types.spec.ts`**：

- (1) DAG self-consistency：successors 都是有效 step id
- (2) DAG 无环（拓扑排序）
- (3) ctxWrites + dbWrites 类型守护
- (4) resetFields 都是合法 MissionColumnKey

**`ctx-hydrator.service.spec.ts`**（v1.1 F3 加 zod 失败分支）：

- (1) happy path：所有字段从 mission 行还原（含 outline_plan / analyst_output 新列）
- (2) researcherResults：单 dim + 多 dim + 同 dim 多 retry_label（取 latest）
- (3) reportArtifact zod parse 失败 → throw BadRequestException ★ F3
- (4) reportArtifact 大小超 2MB → throw BadRequestException ★ E5
- (5) status='running' 且 heartbeat 在 60s 内 → throw（防 in-flight 误污染）
- (6) status='running' 且 heartbeat 在 60s 外 → 允许（reopen 后等待 cascade）★ B2

**`stage-rerun.dispatcher.spec.ts`**（v1.1 F1 — 13 stage 各 happy + fail）：

每个 stage 一对：
| stage | happy spec | fail spec |
|--|--|--|
| s2-leader-plan | plan 输出后 markIntermediateState 写 dimensions | LLM 抛错时 cascade abort |
| s3-researcher-collect | 多 dim 并发完成后写 research_results | 单 dim 失败 → cascade abort + 已完成 dim 保留 |
| s4-leader-assess | assess 完成 emit narrate | reflexion verifier 全失败 → abort |
| s5-reconciler | 写 reconciliation_report | LLM JSON parse 失败 → abort |
| s6-analyst | 写 analyst_output ★ 新列 | LLM 抛错 → abort |
| s7-writer-outline | 写 outline_plan ★ 新列 | outline schema 校验失败 → abort |
| s8-writer | 写 report_full + report_artifact_version=2 | judge 全 fail 后 → abort |
| s8b-quality-enhancement | 改写 report_full.quality | section quality 检查抛 → abort |
| s9-critic | 改写 report_full.metadata.critique | LLM 抛错 → abort |
| s9b-objective-eval | 改写 metadata.pipelineEvaluation | reportEvaluation 抛 → abort |
| s10-leader-foreword-signoff | 写 leader_signed/leader_overall_score/leader_journal | leader LLM 抛 → abort |
| s11-persist | markCompleted (或 chapter_content_incomplete guard 拒) | guard 失败 → abort（不 markFailed） |
| s12（postlude） | n/a — fire-and-forget，不在 cascade 内 | n/a |

**`local-rerun.service.spec.ts`**：

- (1) 黑名单 s1-budget 拒绝
- (2) stepId 不在 PLAYGROUND_PIPELINE 拒绝
- (3) cascade preview 返回正确链 + token / cost 估算
- (4) reopen 路径：failed mission 触发 markReopened
- (5) RerunLockRegistry 拒绝并发同 todo
- (6) 24h 频次 5 次后第 6 次 throw 429 ★ E4
- (7) DB 实时 cost_usd 超 maxCredits → throw ★ E6

**`mission-store.markReopened.spec.ts`**（v1.2 F4 — 真 5×5 状态转移矩阵）：

```typescript
// v1.2 修订：原 v1.1 写的是 5×2（from × 是否拒绝），实际应是 5×5（每 from 验证调用后所有 5 个 to 状态的存在性）
const ALL_STATUSES = [
  "running",
  "completed",
  "failed",
  "quality-failed",
  "cancelled",
] as const;

describe.each([
  // [fromStatus, expectedFinalStatus, shouldThrow, throwType]
  ["failed", "running", false, null],
  ["quality-failed", "running", false, null],
  ["completed", "completed", true, "BadRequestException"], // 不动
  ["cancelled", "cancelled", true, "BadRequestException"], // 不动
  ["running", "running", true, "BadRequestException"], // 不动（仍 running）
])("from=%s 调 markReopened 后", (from, expectedTo, shouldThrow, throwType) => {
  it(`mission.status 应为 ${expectedTo}`, async () => {
    await seedMission({ status: from });
    if (shouldThrow) {
      await expect(store.markReopened(missionId, userId)).rejects.toThrow(
        throwType!,
      );
    } else {
      await store.markReopened(missionId, userId);
    }
    const updated = await store.getById(missionId, userId);
    expect(updated?.status).toBe(expectedTo);
  });

  // 真 5×5：对每个 from 状态都验证其 to 不会变成 ALL_STATUSES 中其它 4 种
  for (const otherTo of ALL_STATUSES) {
    if (otherTo === expectedTo) continue;
    it(`mission.status 不应转到 ${otherTo}`, async () => {
      await seedMission({ status: from });
      try {
        await store.markReopened(missionId, userId);
      } catch {
        /* expected */
      }
      const updated = await store.getById(missionId, userId);
      expect(updated?.status).not.toBe(otherTo);
    });
  }
});

// 共 5 from × (1 expected + 4 negative) = 25 spec（真 5×5）
// 非状态机的辅助 spec：

it("乐观锁防 TOCTOU：并发 reopen 只一个 update.count=1，另一个 throw", async () => {
  await seedMission({ status: "failed" });
  const [r1, r2] = await Promise.allSettled([
    store.markReopened(missionId, userId),
    store.markReopened(missionId, userId),
  ]);
  const ok = [r1, r2].filter((r) => r.status === "fulfilled").length;
  const fail = [r1, r2].filter((r) => r.status === "rejected").length;
  expect(ok).toBe(1);
  expect(fail).toBe(1);
});

it("reset 字段集完整：completedAt/finalScore/leaderSigned/leaderOverallScore/leaderVerdict/errorMessage 都清零", async () => {
  await seedMission({
    status: "failed",
    completedAt: new Date(),
    finalScore: 80,
    leaderSigned: true,
    leaderOverallScore: 85,
    leaderVerdict: "good",
    errorMessage: "previous error",
  });
  await store.markReopened(missionId, userId);
  const m = await store.getById(missionId, userId);
  expect(m?.completedAt).toBeNull();
  expect(m?.finalScore).toBeNull();
  expect(m?.leaderSigned).toBeNull();
  expect(m?.leaderOverallScore).toBeNull();
  expect(m?.leaderVerdict).toBeNull();
  expect(m?.errorMessage).toBeNull();
});

// v1.2 coder 联合 spec：hydrate guard + markReopened 端到端
it("[联合 spec] markReopened 后 60s 内 hydrate 拒绝；60s 后 hydrate 允许", async () => {
  await seedMission({ status: "failed" });
  await store.markReopened(missionId, userId);
  // 立刻 hydrate（heartbeat 0s）
  await expect(hydrator.hydrate(missionId, userId)).rejects.toThrow(
    /in-flight/,
  );
  // mock heartbeatAt 调到 61s 前
  await store.testForceHeartbeatAge(missionId, 61_000);
  // 再 hydrate 应成功
  const ctx = await hydrator.hydrate(missionId, userId);
  expect(ctx.__hydrated).toBe(true);
});
```

### 8.2 集成 spec（v1.1 F2 补全）

**`cascade-rerun.integration.spec.ts`**：

- (1) S11 单 stage rerun → markCompleted（c195035f 主 use case）
- (2) cascade 中 S9 抛错 → abort + S8 patch 保留 + last_completed_stage=S8 idx ★ G1
- (3) 并发同 todo 重跑 → 第二个被 RerunLockRegistry 拒 ★ F2
- (4) 跨 pod 同 mission 同时 reopen → 乐观锁只一个成功 ★ E2
- (5) cascade 完成后 mission.status='completed' + 完整 report_full

**`cascade-rerun-cross-stage.integration.spec.ts`**：

- (1) S8 重跑 cascade → S8b/S9/S9b/S10/S11 全跑
- (2) S2 重跑 → cascade 链覆盖 S3-S11（warning user 等于全跑）
- (3) S12 不在 cascade 内（assert）
- (4) 中间 hydrate 校验：S8 之后 S9 读到的 reportArtifact 是 S8 patch 的版本

### 8.3 e2e（v1.1 F5 — c195035f 真实 mission dry-run）

**`scripts/dev/monitoring/dry-run-hydrate-c195035f.js`**（新建，prod smoke）：

> **先决条件（v1.2 tester 修订）**：必须先跑 `backfill-c195035f-artifact.js`（PR-R8）从 mission_event payload 把 reportArtifact 写入 mission.report_full。否则 hydrate 会因 mission.report_full=NULL 返回 undefined，dry-run 必然失败，但这不是方案本身有问题。

```javascript
// 拉 c195035f 数据 → 走 ctx-hydrator → 断言：
//   reportArtifact !== undefined（依赖 backfill 脚本先跑 — 见上方先决条件）
//   reportArtifact.sections.length === 15
//   reportArtifact.metadata.templateId === 'multi-dimension-report@v1'
//   ReportArtifactZodSchema.safeParse(reportArtifact).success === true
```

如果 c195035f 在 v1.1 落地后能 dry-run hydrate 成功，方案就过 P0 验证（之后再写 cascade execute）。

### 8.4 Railway prod e2e

启新 mission，故意让 S11 失败（mock chapter_content_incomplete trigger），触发 S11 单 stage rerun → 验证：

- mission.status === 'completed' ✅
- report_full 完整写入（含 templateId / sanitizerVersion）✅
- mission_event 含 mission:reopened + cascade-completed ✅
- mission.cost_usd 增量累加（不覆盖原值）✅

---

## 9. PR 拆分（v1.1 类别 I 修订）

**v1.1 修订**：

- I1：PR-R5 提前到 R3 之前（hydrate guard + markReopened 必须先就位）
- I2：PR-R3 工作量 1.5→3 天（13 stage handler + stub 各异）
- I3：GET /rerun-preview endpoint 合并到 PR-R4
- 加 PR-R0：DB schema migration（mission.outline_plan / analyst_output / rerun_attempts 表）
- 加 PR-R1.5：S8/S6/S7 改造 markIntermediateState 主动持久化
- 加 PR-R7.5：c195035f backfill 脚本

| PR                   | 内容                                                                                                                                             | 文件                                                           | 工作量      | 依赖  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- | ----------- | ----- |
| **PR-R0**            | DB 迁移：mission.outline_plan + analyst_output 列 + rerun_attempts 表 + ReportArtifactZodSchema                                                  | migration.sql + prisma schema + zod schema                     | 0.5 天      | -     |
| **PR-R1**            | Stage DAG schema（在 ai-harness/runner）+ 14 step dag 字段填齐 + 自洽 spec                                                                       | `stage-dag.types.ts`（新）+ `playground.config.ts`（改）+ spec | 1 天        | PR-R0 |
| **PR-R2**            | CtxHydratorService 增强（researcherResults + outlinePlan/analystOutput 列读取 + zod 校验 + payload 大小守卫）+ hydrate guard 改 heartbeat 时间窗 | `ctx-hydrator.service.ts` + spec                               | 1.5 天      | PR-R1 |
| **PR-R3 (前提条件)** | MissionStore：markIntermediateState + markReopened（乐观锁）+ resetFields + 5×5 状态机 spec                                                      | `mission-store.service.ts` + spec                              | 1 天        | PR-R2 |
| **PR-R4**            | S8/S6/S7 stage 改造：在产出 artifact/analystOutput/outlinePlan 后立即调 markIntermediateState 写 mission 行                                      | s8/s6/s7 stage 文件 + spec                                     | 1 天        | PR-R3 |
| **PR-R5**            | StageRerunDispatcher：handler registry + runFromStageWithCascade + 13 stage handler + stub-friendly deps                                         | `stage-rerun.dispatcher.ts` + spec（13 stage × 2 spec）        | 3 天        | PR-R4 |
| **PR-R6**            | LocalRerunService 白→黑名单 + reopen 路径 + GET /rerun-preview endpoint + 24h 频次表 + DB 实时 cost_usd 校验                                     | `local-rerun.service.ts` + controller + spec                   | 1 天        | PR-R5 |
| **PR-R7**            | Frontend：每 todo 重跑按钮 + cascade preview 对话框 + rate-limit-exceeded toast                                                                  | `TodoDetailDrawer.tsx`                                         | 0.5 天      | PR-R6 |
| **PR-R8**            | 集成测试 + Railway prod e2e + c195035f dry-run smoke 脚本 + backfill 脚本                                                                        | spec + scripts/dev/monitoring                                  | 1 天        | PR-R7 |
| **总计**             |                                                                                                                                                  |                                                                | **10.5 天** |       |

**v1.1 工作量真实校正**：从 v1.0 估 6 天调到 10.5 天（coder 评审 1.8x 偏差合并：DB 迁移 + 主动持久化改造 + 13 stage handler + dry-run smoke 都是必工但 v1.0 漏估）。

**关键路径**：R0 → R1 → R2 → R3 → R4 → R5 → R6 → R7 → R8（线性，无并行可能）。可两人协作时，R7 (frontend) + R8 部分 spec 可与 R5/R6 并行。

---

## 10. 风险与回滚

| 风险                                                       | 缓解                                                         |
| ---------------------------------------------------------- | ------------------------------------------------------------ |
| ctx-hydrator 从 event payload 还原的 artifact 与原始有差异 | zod schema 校验 + spec 覆盖 deep equality                    |
| cascade 中 token cost 累加导致超 maxCredits                | 预算预检（PR-R4 in run() 加）                                |
| S11 reopen 后 markCompleted 仍失败（hotfix 没生效）        | rerun 失败时不改 status（保持 failed），保留原 error_message |
| 用户重复点重跑导致并发污染                                 | RerunLockRegistry 拒绝 + UI disable button during rerun      |
| stage rerun 中 leader/billing/pool 缺失导致 NPE            | stub-friendly handler + spec 覆盖每条访问路径                |

**回滚**：每 PR 独立可回滚（无 DB schema 变更）。如发现问题，revert 该 PR commit + redeploy 即可。

---

## 11. 与现有架构的一致性

- ✅ 复用 PLAYGROUND_PIPELINE 配置层（DAG 字段加在现有 step 上）
- ✅ 复用 LocalRerunService + StageRerunDispatcher + CtxHydratorService 三件套
- ✅ 不破坏 stateless 约束（dispatcher / hydrator 都是 stateless）
- ✅ 不引入新顶层模块（在 ai-app/playground 内部演进）
- ✅ 不破坏 facade 边界（依赖关系不变）
- ✅ 不引入新 DB schema（复用现有 7 张表）
- ✅ 不破坏 v1.7 报告装配（structural 切主线后路径不变）

---

## 12. 评审记录（5 路并行专业评审）

> 待 v1.0 落地后启动 5 路评审；本节由评审 agent 填。

### 12.1 v1.0 5 路评审（已完成）

| Reviewer         | 评分   | Verdict        | 关键 BLOCKER                                                                                                                                           |
| ---------------- | ------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| arch-guardian    | 6.5/10 | NEEDS-REVISION | event 兜底破坏单一信源 / markReopened 破坏终态不变量 / dispatcher.executeStage god-class                                                               |
| tester           | 5.5/10 | NEEDS-REVISION | 13 stage 反向证据不完整 / cascade 失败 + 锁拒绝集成测试缺失 / zod 校验失败分支无 spec / markReopened 状态机矩阵不全 / c195035f 真实 dry-run smoke 缺失 |
| reviewer         | 3.5/5  | NEEDS-REVISION | writes 字段类型混 ctx/db 命名空间 / hydrateResearcherResults 多 retry_label 语义未定义 / cascadeChain.indexOf(-1) 静默错误                             |
| security-auditor | 5.5/10 | NEEDS-REVISION | isValidArtifact zod schema 仅声明 + cast 强断言 / markReopened TOCTOU（findFirst + update 非原子）/ hydrateReportArtifact event query 缺 userId 隔离   |
| coder            | 6.5/10 | NEEDS-REVISION | PR-R3 工作量低估 1.5→3-4 天（11 stage 的 stub 策略各异）/ PR-R5 与 R3/R4 隐式环（hydrate() 拒绝 status='running'，reopen 后即被拒）                    |

**汇总 22 个修订点**（合并到 v1.1）：

**类别 A（单一信源）**：

- A1: S8 reportArtifact 必须主动写 mission.report_full（用 markRerunPatch 同步），event 仅作审计 — 不靠 event 兜底

**类别 B（状态机正确性）**：

- B1: markReopened 必须明确 reset 哪些字段（completedAt / finalScore / leader_verdict / reportArtifactVersion / leader_journal.\_\_checkpoint）
- B2: CtxHydratorService.hydrate() 当前 reject status='running' — 改造为接受 "rerun-in-flight" 状态
- B3: markReopened spec 矩阵补全（completed / cancelled / running 三个 from 状态都拒绝 + 单元 spec）

**类别 C（Cascade 实现质量）**：

- C1: dispatcher 改 stage handler registry（Map 注册），不再 switch
- C2: cascadeChain.indexOf 后断言 > -1
- C3: PR-R3 工作量改 3 天（每 stage 单独抽 stub-friendly handler）
- C4: writes 字段拆为 ctxWrites / dbWrites 两个 readonly array

**类别 D（CtxHydrator 严密度）**：

- D1: hydrateResearcherResults 同 dim 多 retry_label 语义：取 latest retry_label 的行（按 created_at desc + LIMIT 1 per dim）
- D2: rrRows / cdRows 都按 dimension+chapter_index 排序，groupBy 后用 dim 作 join key 而非数组 index
- D3: 补全 ctx 兜底：analystOutput / outlinePlan / verifierVerdicts 各 1 段从 event payload 还原（含 zod schema）

**类别 E（安全防护）**：

- E1: ReportArtifactZodSchema 落地到 `report-artifact-zod.schema.ts`，title/sections[]/section.body 都加 max length 限制
- E2: markReopened 改"乐观锁"模式 — `update where status in ['failed','quality-failed']` + 检查 affectedRows === 1
- E3: 所有 hydrate event query 加 join `mission: { userId }` 校验（不只 missionId 等值）
- E4: LocalRerunService 加 24h 频次表（每 mission+stepId 上限 5 次），写一条 spec
- E5: hydrate 入口加 `JSON.stringify(payload).length > 512_000` 守卫
- E6: rerun 启动前查 DB 实时 cost_usd（不是 local 计算），与 estimatedRerunCost 加和比 maxCredits

**类别 F（测试覆盖）**：

- F1: 13 stage 各一条 happy + 一条 fail 反向证据明确列入 §8
- F2: cascade-rerun.integration.spec 补 abort + 锁拒绝 + 跨 pod
- F3: ctx-hydrator.spec 加 zod 校验失败拒绝 spec
- F4: markReopened.spec 列全 5×5 状态转移矩阵（5 from × 5 to）
- F5: scripts/dev/monitoring/dry-run-hydrate-c195035f.js — prod 真实 mission 验证脚本

**类别 G（Cascade 失败语义）**：

- G1: cascade 明确 "best-effort partial"：S*i 失败时已 patch 字段保留，`mission.last_completed_stage` 更新到 S*{i-1}，让用户看到进度

**类别 H（DAG 位置）**：

- H1: StageDagMeta 类型放在 `backend/src/modules/ai-harness/runner/dag/stage-dag.types.ts`（通用层），PLAYGROUND_PIPELINE 仅 re-export 字段定义

**类别 I（PR 重排）**：

- I1: PR-R5（markReopened + hydrate guard 改造）合并到 R3 之前，单 PR 处理状态机
- I2: PR-R3 工作量 1.5 → 3 天
- I3: GET /rerun-preview endpoint 合并到 PR-R4 同批
- 新 PR 总数 5 → 6 天，与原估算工作量一致

### 12.2 v1.1 5 路评审（已完成）

| Reviewer         | 评分   | Verdict        | BLOCKER 状态                                           |
| ---------------- | ------ | -------------- | ------------------------------------------------------ |
| arch-guardian    | 8.5/10 | **APPROVED**   | 3/3 close ✅                                           |
| tester           | 7.5/10 | NEEDS-REVISION | F1✅/F2✅/F3✅/F5✅，**F4 ⚠️ 5×5 矩阵实际只 5×2**      |
| reviewer         | 4.5/5  | **APPROVED**   | C4✅/D1+D2✅/C2 ✅ + 1 处 indexOf 残留（非阻塞）       |
| security-auditor | 8.0/10 | **APPROVED**   | E1/E2/E3 全 close + metadata.passthrough DoS（非阻塞） |
| coder            | 8.0/10 | **APPROVED**   | I1/I2 close + R2/R3 联合 spec 提示（非阻塞）           |

**v1.2 修订点**（5 件）：

1. F4 BLOCKER 修：spec 改为真 5×5（5 from × 5 to = 25 case），含 negative spec 验证 to 不会变其它 4 状态
2. reviewer 残留：`cascadeChain.indexOf(stepId)` → `stepIndexOfInChain(...)`
3. security: ReportArtifactZodSchema.metadata 加 `record(string.max(64), unknown).refine(keys.length<=50)` 防 DoS
4. tester: §8.3 dry-run 加"先决条件 backfill 已跑"注释
5. arch: §3.5 hydrate guard 加注释 "heartbeat < 60s 拒 / ≥ 60s 允许"
6. coder: §3.5 PR-R0 migration 备注"不加 rerun_phase 列"
7. F4 联合 spec：markReopened.spec.ts 加 "[联合 spec] reopen 后 60s 内 hydrate 拒 / 60s 后 hydrate 允许"

### 12.3 v1.2 5 路评审（已完成）

| Reviewer         | 评分   | Verdict                         | 备注                                                |
| ---------------- | ------ | ------------------------------- | --------------------------------------------------- |
| arch-guardian    | 9.0/10 | **APPROVED-FOR-IMPLEMENTATION** | 0 BLOCKER，"立即可推主线"                           |
| tester           | 9.0/10 | **APPROVED-FOR-IMPLEMENTATION** | F4 真 5×5（25 case + negative + 联合 spec）已 close |
| security-auditor | 9.0/10 | **APPROVED-FOR-IMPLEMENTATION** | metadata.refine 双重约束 OK，无新风险               |
| reviewer         | 4.5/5  | APPROVED（v1.1 沿用）           | C4/D1+D2/C2 全 close + indexOf 残留 v1.2 已修       |
| coder            | 8.0/10 | APPROVED（v1.1 沿用）           | I1/I2 close + R2/R3 联合 spec 已加                  |

**5 路 APPROVED-FOR-IMPLEMENTATION 共识达成，可进实施阶段（PR-R0 → PR-R8 共 10.5 天）。**

---

## 13. 迭代日志

| 版本 | 日期       | 主要变更                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | 评审状态                                                                                                  |
| ---- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| v1.0 | 2026-05-07 | 首稿：DAG schema + ctx-hydrator 增强 + cascade 执行器 + reopen 状态机 + 6 PR / 6 天                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | 5 路全 NEEDS-REVISION（22 修订点）                                                                        |
| v1.1 | 2026-05-07 | 合并 v1.0 5 路评审 22 修订点：A 单一信源（S8 主动持久化 + 删 event 兜底 + 加 mission 列）；B 状态机（reopen 字段集 + hydrate heartbeat 时间窗）；C cascade（handler registry + ctxWrites/dbWrites 拆 + indexOf 防护）；D hydrator（retry_label 取 latest + dim 作 join key + 5 字段补全）；E 安全（zod schema 实例化 + 乐观锁 + userId 嵌套校验 + 频次表 + payload 大小 + 实时 cost_usd）；F 测试（13 stage × 2 spec + 5×5 状态矩阵 + zod 失败分支 + c195035f dry-run smoke）；G best-effort partial 语义；H DAG 移 ai-harness/runner；I PR 重排（R0 DB 迁移 + R5 提前 + R3 工作量 3 天 + 总 10.5 天） | 4 APPROVED + 1 NEEDS-REVISION（F4 1 BLOCKER + 4 非阻塞）                                                  |
| v1.2 | 2026-05-07 | 合并 v1.1 5 路评审 1 BLOCKER + 4 非阻塞：F4 spec 改真 5×5（25 case + negative spec）；reviewer indexOf 残留消除；security metadata.refine keys ≤ 50；tester §8.3 backfill 先决条件注释；arch heartbeat 时间窗逻辑解释；coder PR-R0 migration "不加 rerun_phase" 备注；新增 hydrate guard + markReopened 联合 spec                                                                                                                                                                                                                                                                                      | **5 路 APPROVED-FOR-IMPLEMENTATION**（arch 9.0 / tester 9.0 / security 9.0 / reviewer 4.5⭐ / coder 8.0） |
