# Agent-Playground 标杆 App 重构方案

**版本：** 1.0
**生效日期：** 2026-05-04
**关联规范：**

- [`.claude/standards/16-ai-engine-harness-structure.md`](../../.claude/standards/16-ai-engine-harness-structure.md)
- [`.claude/standards/17-extension-governance.md`](../../.claude/standards/17-extension-governance.md)
- [`.claude/standards/18-base-layer-file-governance.md`](../../.claude/standards/18-base-layer-file-governance.md)
- [`docs/architecture/ai-engine-harness-mece-refactor-2026-05-02.md`](ai-engine-harness-mece-refactor-2026-05-02.md)

**关联工单：** `docs/prd/todo.md` P0#2 分层架构重构（泛化下沉 / 业务上移）

---

## 一、目标与边界

### 1.1 目标

把 `ai-app/agent-playground` 改造成 GenesisPod 所有 Agent Team 业务的**标杆 app**：

1. App 自身架构清晰：4 层（edge / mission / lifecycle / roles+agents）。
2. 所有可下沉能力归位到 `ai-engine` / `ai-harness` 正确聚合。
3. 新建 ai-app（writing-team / debate-team / planning-team）只需复制
   playground 的 mission+roles+agents 骨架，不必复制任何"基础设施代码"。

### 1.2 不属于本方案的事

- engine / harness 顶层结构调整（属 W17-W22 主线波次）
- agent prompt / duty.md 业务内容修订
- 前端 playground UI 改造
- 新增能力（这是纯重构，零功能变更）

### 1.3 合规约束

本方案的每一个跨层迁移：

- 必须落在 16 §三规范的现有聚合（不新增子目录除非有 ADR）。
- 必须经过 17 §3.1 受控扩展点（engine/tools, engine/skills, engine/llm/providers, harness/protocols, harness/memory）或与 16 §四"跨聚合归位"清单对齐。
- 文件名必须在 18 §Filename Rules 白名单中。
- 单 PR 范围遵守 16 §九 + MECE refactor §八执行流程。

---

## 二、当前 In-Progress 重构盘点

另一 agent 已动手的工作（git status 体现）：

| 拆分前                                                        | 拆分后                                             | 状态                                            |
| ------------------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------- |
| `services/roles/agent-invoker.service.ts` 529 行混合 facade   | 152 行薄壳 + 三个 helper 类                        | ✅ 已落                                         |
| `services/roles/agent-execution-support.ts`                   | 通用执行支撑（invoke / DAG 并发）                  | ✅ 已建                                         |
| `services/roles/agent-playground-event-relay.ts`              | IAgentEvent → DomainEvent 8 种事件映射             | ✅ 已建                                         |
| `services/roles/agent-invocation-policy.ts`                   | preDisableKnownFailingModels + resolveLoopOverride | ✅ 已建                                         |
| `services/mission/workflow/mission-runtime-shell.service.ts`  | session 装配 + heartbeat + wallTimer + cleanup     | ✅ 已建                                         |
| `services/mission/workflow/mission-stage-bindings.service.ts` | buildCtx + buildDeps 抽离                          | ✅ 已建                                         |
| `services/mission/workflow/team.mission.ts`                   | trunk 改用 `runtimeShell.openSession()`            | ✅ 已落但 690 行旧实现仍以 `/* */` 注释挂在文件 |

---

## 三、目标 4 层结构（playground 标杆架构）

```
ai-app/agent-playground/
├── Edge 层 ─────────────────────────── 业务接口
│   ├── agent-playground.controller.ts
│   ├── agent-playground.gateway.ts
│   ├── agent-playground.events.ts
│   ├── agent-playground.module.ts
│   └── dto/run-mission.dto.ts
│
├── Mission 层 ─────────────────────── 业务剧本（其他 app 复制基线）
│   └── services/mission/
│       ├── workflow/
│       │   ├── team.mission.ts                  # trunk
│       │   ├── mission-context.ts               # phase-cut（PR-7 改造）
│       │   ├── mission-deps.ts                  # phase-slim（PR-7 改造）
│       │   ├── mission-runtime-shell.service.ts
│       │   ├── mission-stage-bindings.service.ts
│       │   ├── per-dim-pipeline.ts              # 从 helpers/ 提升（PR-1）
│       │   ├── narrative-emitter.ts             # 从 helpers/ 提升（PR-1）
│       │   └── stages/s1..s12 + s8b + s9b
│       │
│       ├── lifecycle/                            # 业务 schema 持久化
│       │   ├── mission-store.service.ts
│       │   ├── mission-state.service.ts          # ★ PR-5 上提到 harness 后留薄壳或删
│       │   ├── mission-event-buffer.service.ts   # ★ PR-4 上提到 harness 后留薄壳或删
│       │   ├── prisma-mission-checkpoint.store.ts
│       │   └── mission-health.scheduler.ts
│       │
│       ├── rerun/                                # 业务 hydrate（留 app）
│       │   ├── ctx-hydrator.service.ts
│       │   ├── local-rerun.service.ts
│       │   ├── stage-rerun.dispatcher.ts
│       │   └── (rerun-lock.registry.ts → 上提到 harness, PR-3)
│       │
│       └── postmortem/
│           └── (postmortem-classifier.service.ts → 上提到 harness, PR-2)
│
├── Roles 层 ────────────────────────── thin wrapper（留 app）
│   └── services/roles/
│       ├── agent-invoker.service.ts             # facade（保持现状）
│       ├── agent-execution-support.ts           # 留 app（见 PR-9 评估）
│       ├── agent-playground-event-relay.ts      # 留 app（business event prefix）
│       ├── agent-invocation-policy.ts           # 留 app（去掉 preDisable 后，PR-2）
│       ├── runner-state.util.ts                 # 留 app
│       ├── leader.service.ts / researcher / reconciler / analyst / writer
│       │   reviewer / verifier / steward.service.ts
│       └── index.ts
│
└── Agents 层 ─────────────────────── 业务 agent（留 app；PR-8 接 ISkillProvider）
    └── agents/<role>/<role>.agent.ts + duty.md
```

每层职责：

| 层        | 职责                                | 复制做新 app 时改什么                |
| --------- | ----------------------------------- | ------------------------------------ |
| Edge      | controller + gateway + dto + events | 全改                                 |
| Mission   | trunk + stages + ctx + deps         | 改 stage 内容、ctx 结构、events 前缀 |
| Lifecycle | Prisma adapter + scheduler          | 改 Prisma 表名                       |
| Roles     | thin wrapper                        | 改 role 名称、删/增 role             |
| Agents    | agent class + duty.md               | 全改业务                             |

---

## 四、跨层迁移清单（合规版）

### 4.1 ai-app/agent-playground → ai-harness

| #      | 当前位置 (app)                                                                  | 目标位置 (harness)                        | 文件名                              | 规范依据                                                                                                                                                                           |
| ------ | ------------------------------------------------------------------------------- | ----------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **M1** | `services/postmortem/postmortem-classifier.service.ts`                          | `ai-harness/lifecycle/learning/`          | `postmortem-classifier.service.ts`  | 16 §四 跨聚合归位：failure-learner 在 lifecycle/learning；postmortem 同语义同包                                                                                                    |
| **M2** | `services/mission/rerun/rerun-lock.registry.ts`                                 | `ai-harness/lifecycle/mission-lifecycle/` | `rerun-lock.registry.ts`            | 16 §四 跨聚合归位：mission-{abort,ownership,health,orphan,runtime-state} 5 件套已归位此处；rerun-lock 是同形态 mission 级 in-memory primitive                                      |
| **M3** | `services/mission/lifecycle/mission-event-buffer.service.ts`                    | `ai-harness/memory/event-store/`          | `mission-event-replayer.service.ts` | 16 §三 memory 子目录已含 event-store（有 AgentEventStore）；replay buffer 是事件存储+回放原语；18 §Filename `*.replayer.ts` 在白名单                                               |
| **M4** | `services/mission/lifecycle/mission-state.service.ts`                           | `ai-harness/memory/working/`              | `handoff-compactor.service.ts`      | 16 §三 memory/working 含跨阶段 working state；handoff payload 是 stage 间 working memory；18 §Filename `*.compactor.ts` 在白名单                                                   |
| **M5** | `services/roles/agent-invocation-policy.ts` 中 `preDisableKnownFailingModels()` | `ai-harness/lifecycle/learning/`          | `failure-learner-policy.service.ts` | 17 §3.1 lifecycle/learning 是合法扩展点；与 failure-learner.service MECE 互补（lookup vs apply）；M5 完成后 app 侧 agent-invocation-policy.ts 只剩 resolveLoopOverride（业务策略） |

### 4.2 ai-app/agent-playground → ai-engine

| #      | 当前位置 (app)                                                    | 目标位置 (engine)    | 文件名               | 规范依据                                                                                                    |
| ------ | ----------------------------------------------------------------- | -------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------- |
| **M6** | `services/mission/workflow/helpers/similarity.util.ts`（jaccard） | `ai-engine/content/` | `similarity.util.ts` | 16 §二 engine 判别口诀："不需要知道 agent / mission 即能做的事"——纯文本工具完全 fit；harness 不持纯文本原语 |

### 4.3 删除（D 类残留，17 §四）

| #      | 路径                                                              | 原因                                                                                                                                                                      |
| ------ | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D1** | `team.mission.ts:190-545`                                         | 690 行 `/* */` 注释包裹的旧 `runMission`，无移除计划=违反 17 §四 D                                                                                                        |
| **D2** | `services/mission/workflow/helpers/word-count-normalizer.util.ts` | 文件本身就是 `balanceTargetWords` 的参数预设薄壳；facade 已 export                                                                                                        |
| **D3** | `services/mission/workflow/helpers/failure-extraction.utils.ts`   | facade 已 export `extractFailureMessage / extractAgentFailureDiagnostic`；且 `*.utils.ts`（复数）违反 16 §六 + 18 命名                                                    |
| **D4** | `services/mission/workflow/helpers/token-spend.utils.ts`          | facade 已 export `extractTokenSpend / estimateUsdFromTokens`；同上命名违规                                                                                                |
| **D5** | `services/mission/workflow/helpers/` 目录壳                       | 16 §六禁止 helpers/ 杂物袋；M6+D2+D3+D4 完成后只剩 narrative.util / per-dim-pipeline.util / report-artifact-sections.util，平铺到 `services/mission/workflow/` 后删空目录 |

### 4.4 不下沉（撤回原方案的两处误判）

| 项                                                                       | 决策                       | 理由                                                                                                                                                                                      |
| ------------------------------------------------------------------------ | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent-execution-support.ts` 中 `runWithConcurrency / runDagConcurrency` | **保留 app（除非走 ADR）** | 17 §三 runner/ 是半封闭目录；harness 已有 `runner/dag/DAGExecutor` 与 `ConcurrencyLimiter`，必须先证明 playground 这套"DAG + worker pool + flat fallback"组合无法用现有原语合成，才能新增 |
| `agent-playground-event-relay.ts` IAgentEvent → DomainEvent mapper       | **保留 app**               | 17 §3.5 protocols 是协议**适配**扩展点；event type 前缀 `agent-playground.*` 是 app 业务语义；mapper 含 truncatePayload 等 app 特化处理                                                   |

### 4.5 改造但不迁移（留 app 但要修）

| #      | 文件                                                         | 改造                                                                                                                                                                                            | 触发条件  |
| ------ | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| **R1** | `services/mission/workflow/mission-context.ts`               | 按 phase 切：`PlanPhaseCtx → ResearchPhaseCtx → WriterPhaseCtx → SignoffPhaseCtx`；stage 函数签名只接当前 phase                                                                                 | PR-7      |
| **R2** | `services/mission/workflow/mission-deps.ts`                  | 按 stage 集群拆 `ResearchDeps / WriterDeps / ReviewerDeps / PersistDeps`；`MissionStageBindingsService.buildDeps()` 改为 `buildResearchDeps() / buildWriterDeps()` 等                           | PR-7      |
| **R3** | `services/roles/agent-invocation-policy.ts`                  | M5 后只剩 `resolveLoopOverride`；考虑改名 `loop-override.policy.ts`（18 §Filename `*.policy.ts` 在白名单）                                                                                      | PR-2 末尾 |
| **R4** | `services/mission/lifecycle/mission-state.service.ts`        | M4 完成后此文件只剩 thin wrapper 调 harness 的 `HandoffCompactorService`；评估是否完全删除（如调用方都改走 facade）                                                                             | PR-5 末尾 |
| **R5** | `services/mission/lifecycle/mission-event-buffer.service.ts` | M3 完成后此文件只剩 prisma adapter + IBroadcastAdapter 接口实现；业务相关（`accepts(type startsWith "agent-playground.")`）保留 app；通用 buffer 行为下沉                                       | PR-4 末尾 |
| **R6** | `agents/<role>/<role>.agent.ts` 内联 prompt                  | 接入 `ISkillProvider` —— playground 8 agent + 18 duty.md 走 harness SkillRegistry 而非内联（已记录于 memory `project_playground_skill_disconnect.md` / `project_skill_sediment_2026_05_01.md`） | PR-8      |

---

## 五、PR 切分（对齐 W17-W22 波次）

每 PR 单聚合 / 单跨聚合归位 / 不混 rename + 移动 + 改实现（16 §九）。

| PR              | 关联波次        | 范围                                                                                                                                                                 | 风险   | 验收                                                              |
| --------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------- |
| **PR-1**        | playground 自身 | D1 死注释 + D2/D3/D4 薄壳 + D5 解散 helpers/ + 平铺 narrative/per-dim-pipeline/report-artifact-sections 到 `services/mission/workflow/`                              | LOW    | typecheck + 全量 spec 绿                                          |
| **PR-2**        | W17 后续        | M1 postmortem-classifier 跨层迁 `harness/lifecycle/learning/` + 在 `harness/facade/index.ts` 加 export                                                               | LOW    | verify:arch + facade.providers.spec + lifecycle/learning spec     |
| **PR-3**        | W17 后续        | M2 rerun-lock.registry 跨层迁 `harness/lifecycle/mission-lifecycle/` + facade export                                                                                 | LOW    | verify:arch + mission-lifecycle spec                              |
| **PR-4**        | **W21 配合**    | M3 mission-event-buffer 跨层迁 `harness/memory/event-store/mission-event-replayer.service.ts` + R5 留 app 薄 prisma adapter（实现 IBroadcastAdapter）+ facade export | MEDIUM | verify:arch + memory-boundaries.spec + /replay 集成测试           |
| **PR-5**        | **W21 配合**    | M4 mission-state.service 跨层迁 `harness/memory/working/handoff-compactor.service.ts` + R4 评估 app 薄壳是否能删 + facade export + 与 todo P0#1 token 压缩机制对接   | MEDIUM | verify:arch + memory-boundaries.spec + handoff token 估算回归测试 |
| **PR-6**        | **W18 后续**    | M6 similarity.util 跨层迁 `engine/content/similarity.util.ts` + facade export                                                                                        | LOW    | verify:arch + engine/content spec                                 |
| **PR-7**        | **W22 配合**    | R1 mission-context phase 切片 + R2 mission-deps slim + buildStageBindings 改 buildXxxDeps                                                                            | HIGH   | playground 全量 mission spec 全绿 + 远程 mission run 验证         |
| **PR-8**        | **W22 配合**    | R6 agents/\* 接入 `ISkillProvider`；duty.md 由内联读取改走 harness SkillRegistry；与 memory `project_skill_sediment_2026_05_01.md` 已沉淀的 17 SKILL.md 对接         | HIGH   | playground 全量 mission spec + e2e mission run                    |
| **PR-9 (可选)** | W22 末尾        | 撰写 ADR：评估 `runDagConcurrency` 是否能用 harness `runner/dag/DAGExecutor + concurrency/ConcurrencyLimiter` 合成；如能则迁移；不能则保留 app + 在 ADR 标记原因     | MEDIUM | ADR + verify:arch                                                 |

依赖关系：

```
PR-1 ──┐
       ├─→ PR-2 ─→ PR-3
PR-4   │           │
PR-5   │           │
PR-6   │           │
       └───────────┴─→ PR-7 ─→ PR-8 ─→ PR-9
```

PR-1 / PR-2 / PR-3 / PR-6 之间无依赖，可并行；PR-4/5 须等 W21 启动；PR-7/8/9 在 W22。

---

## 六、单 PR 执行 SOP

每个 PR 严格遵守（合并 16 §九 + MECE refactor §八 + 17 §七执行门槛）：

### 6.1 准备

1. 创建分支：`refactor/playground-standardize-pr<n>`
2. 列白名单：本 PR 允许修改的文件路径（防 sub-agent 越权）

### 6.2 文件移动

3. `git mv` 保留历史
4. 内部相对路径用 `@/` 别名重写（避免子树深度漂移）
5. ESLint `no-restricted-imports` 配置如有变更，**先**改配置再移文件

### 6.3 facade 同步

6. 在 `ai-harness/facade/index.ts` 或 `ai-engine/facade/index.ts` 补 export
7. 旧路径如有外部 importer，过渡期用 `@deprecated` 别名一个 PR 周期再删

### 6.4 验证三件套

8. `npm run verify:arch` —— 7 项架构边界全绿
9. `npm run type-check` —— 0 error
10. `npx jest --testPathPattern="<相关>" --no-coverage` —— 相关 spec + facade.providers spec + boundary spec 全绿

### 6.5 合规检查（17 §七执行门槛）

11. 不违反 `no-restricted-imports`（IDE 实时 + lint-staged）
12. 扩展能力已完成 17 §四归类（A/B/C/D 类标记）
13. 涉例外附 ADR
14. 18 §三轴检查：filename / directory / ownership 三项独立通过

### 6.6 提交

15. Commit message 范式：`refactor(playground): standardize-pr<n> <动作摘要>`
16. 单 PR 单 commit（除非验证发现需要修复）；不 amend，发现问题创建新 commit

---

## 七、验收指标

| 指标                                             | 当前基线                                                                | PR 全部完成后目标                                            |
| ------------------------------------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------ |
| `team.mission.ts` 行数                           | 1172（含 690 行死注释）                                                 | < 400                                                        |
| `MissionDeps` 字段数                             | 23 个全打包                                                             | 按 phase 拆 4-6 个，每 stage ≤ 10 字段                       |
| `MissionContext` 字段数                          | 23 个 mutable optional                                                  | 按 phase 切 4 个 ctx 类型                                    |
| ai-app/agent-playground 中"通用基础设施代码"行数 | ~ 2000 行（buffer / state / postmortem / lock / similarity / wrappers） | < 200 行（仅 prisma adapter + business event prefix mapper） |
| `helpers/` 目录                                  | 5 文件 + 1 子 README                                                    | 删除（MECE refactor §六反模式）                              |
| `*.utils.ts`（复数命名违规）                     | 2 个                                                                    | 0                                                            |
| 复制 playground 做新 app 所需改动文件数          | ~ 80 文件                                                               | < 30 文件（主要在 agents/ + dto/ + events/ + stages 业务）   |
| facade 导入合规率（ESLint + boundary spec）      | 100%                                                                    | 100%（保持）                                                 |
| playground mission e2e（远程 Railway）           | 9 路全绿                                                                | 9 路全绿（不退化）                                           |

---

## 八、风险与回滚

### 8.1 风险等级

| PR     | 风险   | 主要风险面                                                                                   |
| ------ | ------ | -------------------------------------------------------------------------------------------- |
| PR-1   | LOW    | 死代码删除、薄壳删除、helpers/ 平铺；都是机械变更                                            |
| PR-2/3 | LOW    | 单文件跨层迁移 + 1 处 facade export；importer 仅 1-3 处                                      |
| PR-4/5 | MEDIUM | 涉及 WS /replay + token 压缩闸门；prisma adapter 留 app 不动 schema                          |
| PR-6   | LOW    | 单纯文本工具迁移                                                                             |
| PR-7   | HIGH   | 23-field ctx → phase ctx 切片；所有 stage 函数签名变；MissionDeps 23 → 拆 4-6 个；测试面巨大 |
| PR-8   | HIGH   | 8 agent + 18 duty.md 接 SkillRegistry；agent class 内部结构变                                |

### 8.2 回滚策略

- 每 PR 单独 commit，`git revert <sha>` 即可回退
- facade `index.ts` 旧 export 路径保留一个 PR 周期作 `@deprecated`，下个 PR 再删
- PR-7 / PR-8 必须先在分支跑完 playground e2e（远程 Railway 9 路）才合并主线

### 8.3 已知阻断项

- PR-4 / PR-5 必须等 W21（memory 契约收敛）启动后再开 —— 否则在老 contract 上迁移，W21 会推倒重来
- PR-7 / PR-8 必须等 PR-1 / PR-2 / PR-3 / PR-6 全部合并 —— 否则 ctx/deps 切片时还要额外处理 helpers/ 残留 + 跨层 import 路径

---

## 九、变更日志预期

合并完成后 `.claude/CLAUDE.md` 与 `docs/architecture/ai-engine-harness-mece-refactor-2026-05-02.md` 须同步：

1. 在 `CLAUDE.md` "AI App 模块 → AI Engine" 关系表追加：playground = 标杆 app，新 app 可参考
2. 在 MECE refactor §十一进度跟踪追加 W17/W21/W22 的 playground 相关 PR commits
3. 在 `services/README.md` 更新目录树（删 helpers/，更新跨层 import 路径）

---

## 十、关联文档

- [`.claude/standards/16-ai-engine-harness-structure.md`](../../.claude/standards/16-ai-engine-harness-structure.md)
- [`.claude/standards/17-extension-governance.md`](../../.claude/standards/17-extension-governance.md)
- [`.claude/standards/18-base-layer-file-governance.md`](../../.claude/standards/18-base-layer-file-governance.md)
- [`docs/architecture/ai-engine-harness-mece-refactor-2026-05-02.md`](ai-engine-harness-mece-refactor-2026-05-02.md)
- [`docs/architecture/extension-governance-rollout-checklist-2026-05-02.md`](extension-governance-rollout-checklist-2026-05-02.md)
- [`docs/architecture/base-layer-directory-contracts-2026-05-02.md`](base-layer-directory-contracts-2026-05-02.md)
- [`docs/prd/todo.md`](../prd/todo.md) P0#1 token 压缩 / P0#2 分层架构重构

---

**最后更新**: 2026-05-04
**维护者**: Claude Code
**版本**: 1.0
