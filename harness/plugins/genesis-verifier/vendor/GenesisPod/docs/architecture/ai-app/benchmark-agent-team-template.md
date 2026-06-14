# Benchmark Agent Team — Template & Copy Guide

**Status:** Stage 3 / S3-1 deliverable(boundary audit Rev 5 §7 Stage 3,2026-05-09 落地)。
**Source:** Distilled from `agent-playground` post-Stage 1 实施(commit `2b93fbbeb` merged into main,Stage 0 commit `67c3f3935`)。
**Audience:** 写新 MissionPipeline 派 Agent Team(`debate-team` / `planning-team` / future)的工程师。

---

## 1. 背景

`agent-playground` 经过 Rev 5 boundary audit + Stage 0/1 实施后,成为 GenesisPod MissionPipeline 派 Agent Team 的 **canonical reference implementation**。本 doc 把"如何用同一架构骨架写新 team"固化为可重复的拷贝指南。

不是这个 doc 范围的内容:

- **业务逻辑**(stage 内的 LLM 调用、prompts、output schema)— 由具体 team 业务决定
- **WorkflowConfig 派 team**(`ai-app/teams/teams/debate-team.config.ts` 等 6 个早期 R1 抽象层 config)— 不在本指南范围,benchmark 仅代表 R1 新轨

---

## 2. Canonical Import Surface(必读)

新 team 与 `ai-harness` 的所有接触都通过 `@/modules/ai-harness/facade`。详见 [`docs/architecture/ai-harness/facade/sediment-topology.md`](../ai-harness/facade/sediment-topology.md) 的 6 sediment zones。

**新 team 实际 import 的 zone 公开符号(经 facade re-export)**:

| 用途                        | 来源 zone                           | 关键 symbol                                                                                                                        |
| --------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Mission pipeline 编排       | Z4 `teams/orchestrator/pipeline/`   | `MissionPipelineOrchestrator` / `MissionPipelineRegistry` / `MissionPipelineConfig` / `defineMissionPipeline`                      |
| Stage primitive 接口        | Z5 `teams/services/stages/`         | `StageRunArgs` / `ResolvedStageHooks` / `runWithStageInstrumentation` / `CrossStageState`                                          |
| BusinessAgentTeam framework | Z3 `teams/business-team/`           | `MissionRuntimeShellFramework` / `EventRelayFramework` / `IBusinessTeamMissionStore` / `RerunGuard`                                |
| Mission lifecycle 原语      | Z1 `lifecycle/mission-lifecycle/`   | `IMissionStore<TBusiness>` / `InMemoryMissionStore` / `MissionAbortRegistry` / `MissionLivenessGuard` / `MissionOwnershipRegistry` |
| Mission checkpoint          | Z2 `memory/mission-checkpoint/`     | `MissionCheckpointService` / `CheckpointStore` interface                                                                           |
| Agent / role primitive      | (`ai-harness/agents/**` via facade) | `AgentSpec` / `DefineAgent` / `BUILTIN_ROLES` / `BUILTIN_TOOLS` / `AgentInvoker`                                                   |

**禁止的 import**(由 `backend/.eslintrc.js` Section 10 + R8 override 强制):

- 任何 `ai-harness/{teams,lifecycle,memory,...}/**` 子路径(必走 facade)
- `ai-app/**/agents/**` 与 `ai-app/**/skills/**` 不得 import `ai-harness/teams/**` 或 `ai-harness/lifecycle/mission-lifecycle/**`(R8)
- `ai-engine/**` 不得出现 `Mission*` / `Stage*` / `Pipeline*` 标识符(facade 自身 + grep gate)

---

## 3. 目录骨架(从 playground 拷贝)

新 team `ai-app/<my-team>/` 目录结构,镜像后端 `ai-app/playground/` 的 post-Stage 1 拓扑:

```
backend/src/modules/ai-app/<my-team>/
├── <my-team>.module.ts                  ← NestJS module:provider 注册 + onModuleInit 加载 skills
├── <my-team>.controller.ts              ← REST 入口(REST endpoint scope)
├── <my-team>.gateway.ts                 ← (可选)WebSocket gateway(若需实时事件)
├── <my-team>.events.ts                  ← 事件类型定义(`<my-team>.mission:*` namespace)
├── <my-team>.event-schemas.ts           ← 事件 payload zod schema
├── <my-team>.config.ts                  ← MissionPipeline 配置(steps + roles + skillSpec)
├── dto/
│   └── run-mission.dto.ts               ← RunMissionInput zod schema
├── agents/                              ← 角色 agent 定义(每个 SKILL.md 对应一个)
│   ├── leader/
│   │   ├── leader.agent.ts              ← AgentSpec + DefineAgent(facade-only import)
│   │   ├── SKILL.md                     ← skill 元数据(由 onModuleInit skillLoader 加载)
│   │   ├── duties/                      ← (可选)duty 描述子目录(参考 leader/steward/writer/verifier;analyst/reconciler/researcher/reviewer 不持 duties/)
│   │   └── soul.md                      ← role 风格 / 立场
│   └── <other-roles>/                   ← 类似 leader/
├── skills/                              ← 业务 skills 元数据集合(同上,SkillLoader 加载)
├── services/
│   ├── README.md                        ← team-specific 架构说明
│   ├── mission/
│   │   ├── workflow/
│   │   │   ├── <my-team>-pipeline-dispatcher.service.ts        ← Runtime-glue:sessions Map / runMission / hooks 装配 / progress / checkpoint / cleanup
│   │   │   ├── <my-team>-business-orchestrator.service.ts      ← Business:STAGE_NUMBER / CHECKPOINT_AT 字面量 + N 个 build*Hooks
│   │   │   ├── <my-team>-cross-stage-state.ts                  ← typed wrapper around Z5 CrossStageState(替代 ad-hoc cache fields)
│   │   │   ├── mission-runtime-shell.service.ts                ← Z3 MissionRuntimeShellFramework adapter
│   │   │   ├── mission-stage-bindings.service.ts               ← buildCtx / buildDeps(stage 函数参数装配)
│   │   │   ├── mission-deps.ts                                 ← phase-specific dep types (CommonDeps / PlanDeps / ...)
│   │   │   ├── mission-context.ts                              ← MissionContext 类型(stage 间共享 ctx schema)
│   │   │   └── stages/                                         ← N 个 stage 函数(s1 → sN)
│   │   ├── lifecycle/
│   │   │   ├── mission-store.service.ts                        ← Prisma store(structurally satisfies Z1.IMissionStore + Z3.IBusinessTeamMissionStore)
│   │   │   └── mission-event-buffer.service.ts                 ← /replay 内存事件缓冲
│   │   └── rerun/                                              ← (可选)mission rerun 路径
│   ├── roles/                                                  ← N 个 role service(agent class 的 NestJS 包装)
│   ├── chat/                                                   ← (可选)用户与 leader 多轮对话
│   └── export/                                                 ← (可选)mission 输出物组装
└── __tests__/                                                  ← 单元 + 集成测试
```

**关键命名约定**:`<my-team>` 替换 `playground`（全文件名 + 类名 + event namespace + skill domain）。事件命名空间延续 `agent-playground.*` 前缀惯例时，以实际业务决策为准。

---

## 4. 拷贝步骤(checklist)

### 4.1 准备阶段

1. **审议未来 consumer**(audit Rev 5 R1 限定语境):新 team 是否真的需要新的 mission pipeline?能否复用 `agent-playground` / `writing-team`?
2. **boundary audit 自审**:新 team 是否会消费现有 5 个 sediment zone?是否 R8 (agents/skills 仅 facade)合规?

### 4.2 复制 + 改名

```bash
# 1. 复制 playground 全目录到 my-team
cp -r backend/src/modules/ai-app/playground backend/src/modules/ai-app/<my-team>

# 2. 全文件 + 类全局 sed:agent-playground → my-team
#
# ★ sed 顺序敏感性(Round Y reviewer C):必须按 kebab → PascalCase → 标题词
#   顺序执行,**禁止颠倒**。颠倒会导致 `<MyTeam>` 反复替换,产生 `<MyTeam>-event-relay.ts`
#   被再次匹配成 `<<MyTeam>>-event-relay.ts` 的破坏性叠加替换。
find backend/src/modules/ai-app/<my-team> -type f \( -name "*.ts" -o -name "*.md" \) \
  -exec sed -i 's/agent-playground/<my-team>/g; s/AgentPlayground/<MyTeam>/g; s/Playground/<MyTeam>/g' {} +

# 3. 重命名所有 file 名
# 手动 rename: agent-playground.module.ts → <my-team>.module.ts (等)

# 4. 注册新 module 到 app.module.ts
```

### 4.3 业务定制

- **删/改 stage**:`<my-team>.config.ts` 的 `steps[]` 改为新 team 的 stage 列表。删 `services/mission/workflow/stages/sX-*.stage.ts` 不需要的;改 stage 内 `runX(ctx, deps)` 的 LLM 调用、prompt、schema。
- **改 role / agent**:`agents/<role>/{soul,duty}.md` 改为新业务语义;`<role>.agent.ts` 的 `AgentSpec` schema 改 input/output。
- **改 event namespace**:`<my-team>.events.ts` 改 `<my-team>.mission:*` 等命名空间;前端 todo-ledger 同步。
- **改 mission DB schema**:`prisma/schema/<my-team>.prisma` 加新 team 的 mission 表(对齐 `IBusinessTeamMissionStore` 7 lifecycle 方法 + Z1.`IMissionStore` 9 generic 方法 — see §5)。
- **改 controller endpoint**:`<my-team>.controller.ts` 的 `/api/v1/<my-team>/team/run` 等 REST surface。

### 4.4 cross-stage state(关键!参考 `playground-cross-stage-state.ts`)

新 team 的 `<my-team>-cross-stage-state.ts` 必须是 Z5 `CrossStageState` 的 typed wrapper(不是 ad-hoc class field cache)。原因:audit T3 closes 后,benchmark 不再持 dispatcher class body cache fields(grep gate 强制)。

**不要做**:

```typescript
// ❌ 反 audit: dispatcher class body cache fields
class MyTeamDispatcher {
  private lastPlan?: ...;        // ← grep gate fail
  private lastResearcherResults?: ...;
  ...
}
```

**要做**:

```typescript
// ✅ Z5 typed wrapper(参考 playground-cross-stage-state.ts)
import { CrossStageState } from "@/modules/ai-harness/facade";

export class MyTeamCrossStageState {
  private readonly inner: CrossStageState;
  constructor(initial?: CrossStageState) {
    this.inner = initial ?? new CrossStageState();
  }
  get lastPlan(): MyTeamPlan | undefined {
    return this.inner.get<MyTeamPlan>("lastPlan");
  }
  set lastPlan(v: MyTeamPlan | undefined) {
    this.inner.set("lastPlan", v);
  }
  // ... 其他 stage 中间产物 typed getter/setter
  toJSON() {
    return this.inner.toJSON();
  }
  static fromJSON(data: Record<string, unknown>) {
    return new MyTeamCrossStageState(CrossStageState.fromJSON(data));
  }
}
```

SessionEntry 内只持 `crossState: MyTeamCrossStageState`,不直接持 cache fields。

### 4.5 跨 app 共享 mission surface(若被其他 ai-app 消费)

如果 `ai-app/custom-agents/`、`ai-app/<other>/` 需要调你的 mission runner(参考 `agent-playground` 与 `custom-agents` 的 S1-5 解耦):

1. 在 `ai-app/contracts/mission-platform.contract.ts` 加新 token(若你的 surface 是 generic — 否则可以建你自己的 contract file under `ai-app/contracts/<my-team>-platform.contract.ts`)
2. 在 `<my-team>.module.ts` 用 `useExisting` 把具体类绑到 token
3. 跨 app 消费方 `@Inject(MY_TEAM_RUNNER)` 用 interface 类型,不直 import 你的具体类

### 4.6 mechanical guard suite(部分自动 + 部分需手动加)

Stage 0 mechanical guard suite(`backend/.eslintrc.js` + `scripts/ci/check-harness-namespace.sh`)对新 team 的覆盖**不全自动**:

**自动覆盖**(`scripts/ci/check-harness-namespace.sh` 通用规则):

| Gate                   | 规则                                                    | 新 team 是否需要改                                |
| ---------------------- | ------------------------------------------------------- | ------------------------------------------------- |
| [R6]                   | `ai-harness` 不 import `ai-app`                         | ✅ 自动                                           |
| [STEPID]               | `ai-harness` 不出现 step-id 字面量(`s\d+[a-z]?-` regex) | ✅ 自动                                           |
| [STAGE-NUM]            | `ai-harness` 不出现 stage-number 字面比较               | ✅ 自动                                           |
| [S1-2]                 | dispatcher class body 不出现 cache fields               | ✅ 自动(由 `<my-team>-cross-stage-state.ts` 满足) |
| [ENGINE]               | `ai-engine` 不出现 mission-aware identifier             | ✅ 自动                                           |
| ESLint R8 / Section 10 | ai-app/**/agents/** + skills/\*\* 仅 facade-import      | ✅ 自动(规则按 path glob 匹配)                    |

**需手动加**(`scripts/ci/check-harness-namespace.sh` 当前 hardcode `agent-playground` / `AGENT_PLAYGROUND_` / `PLAYGROUND_`):

| Gate       | 当前实现                           | 新 team 必须做                                                                |
| ---------- | ---------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| [NS]       | grep `'agent-playground\.'` 字面量 | 在脚本内追加 `'<my-team>\.'` 字面量检查(防 `ai-harness` 引用新 team 命名空间) |
| [DI-TOKEN] | grep `(AGENT*PLAYGROUND*           | PLAYGROUND\_)`                                                                | 在脚本内追加 `<MY_TEAM>_*` / `MY_TEAM_*` 模式(防 `ai-harness` 反向 reference 新 team token) |

Stage 3 / S3-2 invariants doc §7 footer 已声明此规则;新 team PR 必须同 commit 修改 grep gate 脚本。

**验收**:跑 `bash scripts/ci/check-harness-namespace.sh` 应 EXIT=0(strict mode 7/7 + 新 team 添加的 gate)。

---

## 5. Mission Store 双视角实现(§T1 子集关系)

新 team 的 mission store **同时 satisfies 两个 interface**(structural typing):

| Interface                   | Zone | 视角                             | 方法集                                                                                                                                                             |
| --------------------------- | ---- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `IMissionStore<TBusiness>`  | Z1   | generic CRUD 端口                | `create` / `getById` / `listByUser` / `updateStatus` / `setLastCompletedStepId` / `appendDecision` / `getDecisions` / `saveCrossStageState` / `getCrossStageState` |
| `IBusinessTeamMissionStore` | Z3   | BusinessAgentTeam lifecycle 视角 | `refreshHeartbeat` / `clearHeartbeat` / `markStageComplete` / `countRunningByUser` / `cleanupOrphanRunningMissions` / `markFailed` / `markReopened`                |

两个 interface **method 名互不重叠**(Z3 是 Z1 的互补集合,见 audit §2.5 T1)。新 team store 实现这 9+7 = 16 个方法即可被 Z3 framework 与 Z1 generic 调用方都消费。

详见:

- `backend/src/modules/ai-harness/teams/business-team/abstractions/mission-store.interface.ts`(Z3 IBusinessTeamMissionStore + JSDoc 子集说明)
- `backend/src/modules/ai-harness/lifecycle/mission-lifecycle/abstractions/mission-store.interface.ts`(Z1 IMissionStore<TBusiness>)

---

## 6. 验收清单(新 team 落地前)

| #   | 检查项                                                                                | 验证方式                                                        |
| --- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------- | --------------------- | --------------------------------------------------- |
| 1   | tsc 通过                                                                              | `cd backend && npx tsc --noEmit; echo "EXIT=$?"` → EXIT=0       |
| 2   | grep gate 7/7 green                                                                   | `bash scripts/ci/check-harness-namespace.sh` → exit 0           |
| 3   | dispatcher 拆为 runtime-glue + business-orchestrator,无 cache fields                  | grep `(lastPlan                                                 | lastResearcherResults | s4PatchFailures)` 在 dispatcher class body → 0 命中 |
| 4   | cross-stage state 走 `<my-team>-cross-stage-state.ts`(Z5 wrapper)                     | inspect `SessionEntry` 仅含 `crossState: MyTeamCrossStageState` |
| 5   | agents/skills 仅 import `@/modules/ai-harness/facade`                                 | ESLint R8 rule 自动验证                                         |
| 6   | mission store 同时 satisfies Z1.`IMissionStore` + Z3.`IBusinessTeamMissionStore`      | structural typing 编译通过 / 单测覆盖 9+7 method                |
| 7   | contract test 锁 sediment zone surface(参考 `sediment-zone-surface.contract.spec.ts`) | jest pass                                                       |
| 8   | integration smoke spec 覆盖 mission runMission happy path                             | jest pass                                                       |

---

## 7. 不变式(refer to invariants doc)

完整 mechanical 守护规则与边界不变式见 [`benchmark-agent-team-invariants.md`](./benchmark-agent-team-invariants.md)。

---

## 8. 维护规则

- 本 doc 与 `agent-playground` 实际拓扑保持同步。任何 `agent-playground` 结构性变更(Stage 2 lift / 新 stage 加入等)必须同步更新本 doc。
- 新 team 落地前必须按 §6 验收清单全跑一遍并附 PR 引用。
- 本 doc 与 audit Rev 5 §7 Stage 3 / sediment-topology.md / boundary-audit-2026-05-08.md 保持一致。
