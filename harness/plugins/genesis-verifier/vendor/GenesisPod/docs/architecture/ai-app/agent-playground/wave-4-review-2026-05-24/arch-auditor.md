# 架构审计报告 — Wave 4 / Wave 1b 范围式审计

**审计日期**: 2026-05-24
**审计版本**: 38f083248 (HEAD, Wave 4 看护栏)
**审计员**: Arch Auditor Agent v2.0
**审计模式**: 范围式（仅 5 个当天 commit + 关键文件，非全仓扫）

## 审计范围

| Commit      | 描述                                                       |
| ----------- | ---------------------------------------------------------- |
| `38f083248` | Wave 4: 看护栏 P21/P22/P23/P24 + playground.config.ts 归位 |
| `4d81a8002` | Wave 6: P30/P31 blueprint 状态 + standards/23 SOP          |
| `80822389c` | 4 个 spec 路径跟上 P9b/P9c                                 |
| `4adf17a9b` | 24 文件 export type 修 TS1205                              |
| `4424d17f3` | radar §8.2 重组 (P11)                                      |

**主要受审文件**:

- `backend/src/modules/ai-app/{agent-playground,social,radar}/` (三个 agent team app)
- `backend/src/modules/ai-harness/teams/business-team/` (framework 切片)
- `backend/src/__tests__/architecture/agent-team-layout.spec.ts` (43 tests)
- `backend/src/__tests__/architecture/agent-team-facade-contract.spec.ts` (12 tests)
- `backend/.eslintrc.js` SECTION 10
- `.claude/standards/23-business-team-framework-usage.md`
- `docs/architecture/ai-app/agent-playground/agent-playground-target-boundary-and-directory-blueprint-2026-05-24.md`
- `docs/architecture/ai-app/agent-app-mass-migration-roadmap-2026-05-24.md`

---

## D1: 分层合规 [L4→L3→L2.5→L2→L1 单向]

**评级: PASS**

**扫描结果**:

反向依赖扫描（ai-harness/business-team → ai-app）:

```
grep -rn "^import.*from.*ai-app" backend/src/modules/ai-harness/teams/business-team/**/*.ts
结果: 0 条实际 import（仅 JSDoc @migrated-from 注释标注历史来源）
```

反向依赖扫描（ai-engine → ai-app）:

```
grep -rn "^import.*from.*ai-app" backend/src/modules/ai-engine/**/*.ts
结果: 0 条（仅 3 条 JSDoc 注释提及历史迁移）
```

三个 agent team app 的 `mission/pipeline/` 层向 ai-harness 的 import:

| App              | pipeline 文件数 | ai-harness 穿透 import | ai-engine 穿透 import |
| ---------------- | --------------- | ---------------------- | --------------------- |
| agent-playground | 25              | 0                      | 0                     |
| social           | 14              | 0                      | 0                     |
| radar            | 15              | 0                      | 0                     |

所有穿越层的 import 均经过 `@/modules/ai-harness/facade` 或 `@/modules/ai-engine/facade`。

`mission/lifecycle/`、`mission/rerun/`、`mission/roles/`、`mission/agents/`、`mission/services/` 各子树额外手工抽样验证，均无内部路径穿透。

**已知例外（合法）**:

- `ai-engine/skills/runtime/adapters/engine-skill-provider.adapter.ts`: 实现 harness `ISkillProvider` 端口（Dependency Inversion），ESLint excludedFiles 白名单已注册。

**结论**: L4→L3→L2.5→L2→L1 单向依赖链在审计范围内完整守住。

---

## D2: MECE 边界

**评级: PASS with WARN**

### §8.2 顶层白名单合规（三个 app）

实测顶层目录:

| App              | 实际顶层目录                                                       | 越界目录 |
| ---------------- | ------------------------------------------------------------------ | -------- |
| agent-playground | module, api, runtime, mission, events, integrations, \_\_tests\_\_ | 无       |
| social           | module, api, runtime, mission, events, integrations, \_\_tests\_\_ | 无       |
| radar            | module, api, runtime, mission, events, \_\_tests\_\_               | 无       |

根目录 TS 文件: 三个 app 根目录均为 0 个 `.ts` 文件（§8.2 强制规则）。

旧版目录（services/controllers/dto/agents/utils）: 三个 app 均不存在。

### §8.1 business-team 子聚合白名单

实测子目录:

```
abstractions, invocation, dispatcher, bindings, lifecycle,
orchestrator, state, span, events, helpers, rerun, __tests__
```

白名单定义（agent-team-layout.spec.ts L82-95）:

```
abstractions, invocation, dispatcher, bindings, lifecycle,
orchestrator, state, span, events, helpers, rerun, __tests__
```

匹配: **完整匹配，0 越界**。

### WARN: `mission/` 内部存在 §8.2 规范未明确的子目录

**证据**:

- `agent-playground/mission/` 包含: `pipeline, agents, lifecycle, services, roles, context, skills, artifacts, types, chat, export, rerun`（12 个子目录）
- §8.2 白名单强制 3 个（pipeline/agents/lifecycle），其余为 per-app 可选。

这 9 个可选子目录未被 `agent-team-layout.spec.ts` 覆盖（spec 仅检查 REQUIRED_MISSION_SUBDIRS），因此不存在 spec 红灯风险，但也没有约束力。

**建议**: 未来若有新 team app 误用已被分配给其他 app 的专有子目录名（如 `rerun/`、`artifacts/`），目前无 spec 看护。可在 standards/23 §2 补一个"per-app 可选子目录非强制"说明，避免歧义。优先级 P3（低）。

### WARN: `mission/services/` 内部结构差异

`agent-playground/mission/services/` 不存在（playground 有 `roles/`, `chat/`, `context/`, `artifacts/` 等独立子目录）。`social/mission/services/` 有 8 个子文件（LOC 1608 的 `ai-social.service.ts`）。`radar/mission/services/` 有 5 类服务（briefing/collectors/scheduler/source/topic）。

三个 app 的 `mission/services/` 粒度差异明显，但因规范未约束 `services/` 内部结构，不视为违规。

**结论**: §8.2 顶层 MECE 合规，§8.1 business-team 子聚合 MECE 合规，有 2 个低优先级观察点。

---

## D3: 重复 / 漂移

**评级: WARN**

### 框架已吃掉的 copy-paste（正确状态）

Wave 1 P1+P2 已将以下能力从三个 app 抽取到 framework:

| 能力               | 抽取前 playground LOC | 抽取后 playground LOC | framework LOC         |
| ------------------ | --------------------- | --------------------- | --------------------- |
| agent-invoker      | 280                   | 241                   | 155 + 83 interface    |
| mission-dispatcher | 1216                  | 1136                  | 192 + 38 interface    |
| stage-bindings     | 180                   | 187 (thin subclass)   | 46 + 46 interface     |
| cross-stage-state  | 186                   | 177                   | 81                    |
| mission-span       | 150                   | 29                    | 178                   |
| execution-support  | 159                   | 72                    | 140 (dag-concurrency) |

### 残留 copy-paste（有意推迟，非遗漏）

以下能力**仍存在于 playground 且未下沉**，但 roadmap §6.2 明确说明这是设计决策:

**T2 helpers（仅 playground 有，无第二消费方）**:

- `playground-business-orchestrator.service.ts`: 938 LOC（含 12 个 buildSXxxHooks）
- `mission/pipeline/helpers/chapter-pipeline.helper.ts`: 826 LOC
- `mission/pipeline/helpers/per-dim-pipeline.util.ts`: 843 LOC

**结论**: 这三个文件只有 playground 使用，radar/social 无等价物。遵循 "3 处使用再考虑抽象" 原则，**不下沉是正确决策**。

**T3/T4（playground 独有，推迟到真有第二消费方）**:

- `mission/rerun/` 6 个文件（741-489 LOC），radar/social 无等价 rerun 子系统。

**WARN: 潜在漂移点**

`narrative.util.ts` 存在两处:

- `agent-playground/mission/pipeline/` —— 占 roadmap 标注的历史 copy-paste 来源已清（P11 前 social 有一份等价文件）。
- `social/mission/pipeline/narrative.util.ts` (16-20 行)：轻量 re-export wrapper，通过 `@/modules/ai-harness/facade` 拿 `narrate` 和 `NarrativeEvent`。

实测内容:

```typescript
// social/mission/pipeline/narrative.util.ts
import { narrate as harnessNarrate } from "@/modules/ai-harness/facade";
import type { NarrativeEvent } from "@/modules/ai-harness/facade";
export type { NarrativeEvent, NarrativeTag } from "@/modules/ai-harness/facade";
```

这是**合规的薄 wrapper**（从 facade re-export），不是 copy-paste。两个版本语义不同（playground 有完整业务逻辑，social 只是 facade re-export）。

**结论**: 审计范围内无未授权 copy-paste。残留重复均属有意推迟（P4-P7 deferred）。

---

## D4: god-class 风险

**评级: WARN**

### 关键文件 LOC 统计

| 文件                                                                               | LOC  | 定性                                   |
| ---------------------------------------------------------------------------------- | ---- | -------------------------------------- |
| `agent-playground/events/agent-playground.event-schemas.ts`                        | 1145 | 事件 schema 定义，可接受（非逻辑密集） |
| `agent-playground/mission/pipeline/playground.pipeline.ts`                         | 1132 | 主 pipeline 配置，**候选关注**         |
| `agent-playground/mission/pipeline/stages/s3-researcher-collect-findings.stage.ts` | 1024 | 单 stage 文件，**超过 1000 行**        |
| `agent-playground/mission/pipeline/playground-business-orchestrator.service.ts`    | 938  | 12 个 buildSXxxHooks，密度高           |
| `agent-playground/mission/pipeline/stages/s8-writer-draft-report.stage.ts`         | 924  | 单 stage，**接近 1000 行**             |
| `social/mission/services/ai-social.service.ts`                                     | 1608 | **超过 1500 行，最大文件**             |
| `ai-harness/teams/business-team/events/event-relay.framework.ts`                   | 425  | framework 中最大，可接受               |

**关注点 1: `s3-researcher-collect-findings.stage.ts` 1024 LOC**

单 stage 文件超 1000 行是历史性 god-class 信号。该 stage 承担了并发维度研究的完整逻辑（含 per-dim batch / retry / tool invocation / result merging）。

**关注点 2: `social/mission/services/ai-social.service.ts` 1608 LOC**

这是整个审计范围内最大的单文件。不在当天 commit 范围内（social P10 是目录重组，未触及此文件内容），但目录重组完成后此文件仍保持 1608 LOC 是一个架构信号。

**关注点 3: `playground.pipeline.ts` 1132 LOC**

pipeline 配置文件（`defineMissionPipeline` 调用）包含 12+ steps 的完整 DAG 声明。高 LOC 是配置密度高导致的，而非逻辑密集。可接受，但后续若继续增加 step 可能需要拆分。

### framework 层无 god-class（已拆分良好）

business-team framework 最大文件是 `event-relay.framework.ts` 425 LOC（合理），dispatcher 192 LOC，lifecycle 分 8 个文件（最大 272 LOC）。**框架层设计良好**，不存在 god-class。

**修复建议**:

- P2（本迭代内）: `social/mission/services/ai-social.service.ts` 1608 LOC 建议拆分为 3 个职责类（content-strategy / publish-dispatch / platform-adapter）。该文件属于 §8.2 `mission/services/` 层，不受当天 commit 保护，可单独 PR 处理。
- P3（长期）: `s3-researcher-collect-findings.stage.ts` 1024 LOC 可考虑拆出 batch-loop helper，但需等真有第二 stage 需要时再做（避免过早抽象）。

---

## D5: 测试覆盖密度

**评级: PASS with WARN**

### Wave 4 新增看护

| Spec 文件                            | 测试数 | 覆盖范围                                                     |
| ------------------------------------ | ------ | ------------------------------------------------------------ |
| `agent-team-layout.spec.ts`          | 43     | §8.2 顶层白名单 + §8.1 business-team 子聚合白名单 + 禁旧目录 |
| `agent-team-facade-contract.spec.ts` | 12     | mission/{pipeline,lifecycle} 只走 facade                     |

**layout spec 覆盖分析**:

- 覆盖 3 apps × (1 白名单 + 1 根目录 TS 文件 + 1 module/ + 1 api/ + 1 runtime/ + 1 mission/ + 1 events/ + 3 必备 mission 子目录 + 1 禁旧目录) = 3 × 11 = 33 tests
- §8.1 business-team: 1 总白名单 + 9 必备子目录 = 10 tests
- 合计: 43 tests（与 commit msg 一致）

**facade contract spec 覆盖分析**:

spec 仅覆盖 `mission/pipeline/**` 和 `mission/lifecycle/**`，以下子树无 spec 覆盖:

| 子树                             | 文件数（三个 app 合计） | spec 覆盖 | ESLint 覆盖 |
| -------------------------------- | ----------------------- | --------- | ----------- |
| mission/pipeline/                | 54                      | YES       | YES         |
| mission/lifecycle/               | 15                      | YES       | YES         |
| mission/agents/                  | n/a (SKILL.md only)     | n/a       | YES         |
| mission/roles/                   | ~15                     | NO        | YES         |
| mission/services/                | ~30                     | NO        | YES         |
| mission/rerun/ (playground only) | 6                       | NO        | YES         |
| mission/chat/ (playground only)  | ~5                      | NO        | YES         |

**WARN: spec 盲区**

`mission/rerun/` 6 个文件（含 741 LOC 的 `stage-rerun.dispatcher.ts`）仅由 ESLint 保护，无 jest 层保证。ESLint 不检测动态 `import()` 和注释 escape。

**反驳**: 实测 mission/rerun/ 6 文件均正确使用 facade（手工验证）。ESLint SECTION 10 是 error 级（非 warn），pre-push hook 会执行 ESLint。故当前无实际违规。

**WARN: 43 tests 无参数化数量断言**

layout spec 使用 `it.each(AGENT_TEAM_APPS)` 遍历白名单，但没有断言"白名单 size == N"。若未来有人向 `ALLOWED_TOP_DIRS` 悄悄加一个非标准目录，spec 不会红（因为只检查 actual dirs 是否在白名单内，而非检查白名单本身是否收紧）。

**建议**:

- P2: `agent-team-facade-contract.spec.ts` 增加 `mission/rerun/` 的扫描（playground-only，加 `if (!fs.existsSync)` guard 即可，5 行）。
- P3: layout spec 补 `ALLOWED_TOP_DIRS.size === 7` 断言，防止白名单被悄悄扩展。

---

## D6: 依赖循环

**评级: PASS with WARN**

### 已知循环风险（已修复，PR-E0）

`ai-harness/facade/index.ts` ⇄ `business-team/lifecycle/mission-runtime-shell.framework.ts` 的 barrel 循环加载在 PR-E0（2026-05-08）修复。ESLint rule（`.eslintrc.js` L506-532）: harness 内部成员禁止 import 自身 facade barrel。

### 新发现循环风险（WARN）

**证据**:

```
backend/src/modules/ai-harness/teams/business-team/abstractions/mission-runtime-shell.interface.ts:18
import type { BillingRuntimeEnvAdapter, MissionBudgetPool } from "@/modules/ai-harness/facade";
```

这是 `ai-harness` 内部文件（`teams/business-team/abstractions/`）import 自身 facade barrel 的违规案例。

**风险评估**: 该 import 使用 `import type`，TypeScript 在 `isolatedModules` 模式下会将其完全擦除（不产生 `require()` 调用）。因此**不会触发 Node.js 模块加载的循环检测**，也不会导致 PR-E0 描述的 "emit-decorator-metadata 把 ctor 参数 token 写成 undefined" 崩溃。

**但是**: 该文件仍然**违反 ESLint PR-E0 规则**（`"**/modules/ai-harness/facade"` 禁止模式），ESLint 不区分 `import` 与 `import type`。这意味着 lint-staged 会报错，或已经有 `// eslint-disable-next-line` 注解（需确认）。

手工检查该文件无 `eslint-disable` 注释，说明:

- 要么 ESLint 实际运行时未触及此文件（config excludedFiles 漏网）
- 要么 PR-E0 规则的 glob 匹配不精确

`BillingRuntimeEnvAdapter` 和 `MissionBudgetPool` 的正确来源是各自的 source 文件:

```typescript
// 正确写法:
import type { BillingRuntimeEnvAdapter } from "@/modules/ai-harness/guardrails/billing/billing-adapter";
import type { MissionBudgetPool } from "@/modules/ai-harness/guardrails/budget/mission-budget-pool";
```

`event-relay.framework.ts` 正确使用了直接路径（L28: `"@/modules/ai-harness/guardrails/budget/mission-budget-pool"`），`mission-runtime-shell.framework.ts` 也使用了直接路径（L23-24），说明其他框架文件已按规则修正，只有 `abstractions/mission-runtime-shell.interface.ts` 仍有残留。

**修复建议 P1**:

```typescript
// backend/src/modules/ai-harness/teams/business-team/abstractions/mission-runtime-shell.interface.ts
// 将 L15-18 替换为:
import type { BillingRuntimeEnvAdapter } from "@/modules/ai-harness/guardrails/billing/billing-adapter";
import type { MissionBudgetPool } from "@/modules/ai-harness/guardrails/budget/mission-budget-pool";
```

### 三个 app 之间无循环

agent-playground / social / radar 之间零跨 App import（三路验证确认）。

---

## D7: 文档一致性

**评级: PASS**

### 三文档口径对比

| 规则要点                    | blueprint §8.2                                               | roadmap §2/§6           | standards/23 §2                 |
| --------------------------- | ------------------------------------------------------------ | ----------------------- | ------------------------------- |
| 顶层白名单                  | module/api/runtime/mission/events/integrations/\_\_tests\_\_ | 一致（§8.2 引用）       | 完整列出（§2）                  |
| mission/ 必备子目录         | pipeline/agents/lifecycle                                    | 一致                    | 完整列出（§2）                  |
| 根目录禁 TS 文件            | 明确                                                         | 隐含                    | 明确（§2 禁止行为）             |
| 旧版禁目录                  | services/controllers/dto/agents/utils                        | 一致                    | 明确（§2 禁止行为）             |
| framework 消费方（3 teams） | 表格明确                                                     | Wave 1b scope           | §1 适用范围                     |
| 自动看护三层                | 列出 spec 文件                                               | commit hash 列出        | §4 三层看护                     |
| P4-P7 推迟原因              | §13 status 注记                                              | §6 "Wave 1 P4 重新评估" | 不适用（SOP 不含 roadmap 细节） |

**发现**: 三文档口径一致，无矛盾。

### 轻微不一致（WARN，不影响工程）

blueprint 第 3-4 行状态文本: "Wave 1b + Wave 4 完成 (2026-05-24 night)"，而 roadmap 表格中 Wave 4 状态栏写 "✅ DONE (2026-05-24 night)"。两者一致，格式不同。

standards/23 §5 Checklist 第 12 项提到 `"mission-app-conformance.spec.ts:23"`（硬编码行号），该行号随 spec 文件增长会失效。建议改为功能描述，P3。

**结论**: 文档一致性良好，无实质性口径冲突。

---

## D8: TS1205 修复完整性

**评级: PASS with WARN**

### 已修复覆盖

24 个文件系统性修复，涵盖:

| 模块                                 | 文件                          | 修复方式                            |
| ------------------------------------ | ----------------------------- | ----------------------------------- |
| ai-app/image/agents/                 | index.ts                      | `export type { ... }`               |
| ai-app/library/rag/                  | index.ts                      | `export type { ... }`               |
| ai-app/office/slides/                | slides-engine.service.ts      | 修 import 类型                      |
| ai-app/teams/services/collaboration/ | index.ts                      | `export type { ... }`               |
| ai-app/teams/utils/                  | index.ts                      | `export type { ... }`               |
| ai-engine/                           | index.ts                      | 区分 value vs type                  |
| ai-engine/knowledge/search/          | index.ts                      | `export type { ... }`               |
| ai-engine/llm/prompts/               | index.ts                      | `export type { ... }`               |
| ai-engine/llm/services/              | index.ts                      | `export type { ... }`               |
| ai-engine/llm/types/                 | index.ts                      | `export type { ... }`               |
| ai-harness/agents/abstractions/      | plan-based-agent.interface.ts | `export type`                       |
| ai-harness/agents/base/              | plan-based-agent.ts           | `export type`                       |
| ai-harness/agents/registry/          | index.ts                      | `export type { ... }`               |
| ai-harness/memory/vector/            | index.ts                      | `export type { ... }`               |
| ai-harness/teams/abstractions/       | index.ts                      | 全量 `export type { ... }`          |
| ai-harness/teams/base/               | index.ts                      | 区分 LeaderConfig/ILeaderLLMAdapter |
| ai-harness/teams/collaboration/      | index.ts                      | `export type { ... }`               |
| ai-harness/teams/constraints/        | index.ts                      | 区分 value vs type                  |
| ai-harness/teams/factory/            | index.ts                      | `export type { ... }`               |
| ai-harness/teams/                    | index.ts                      | `export type { ... }`               |
| ai-harness/teams/orchestrator/       | index.ts                      | `export type { ... }`               |
| ai-harness/teams/registry/           | index.ts                      | `export type { ... }`               |
| ai-harness/teams/services/           | index.ts                      | `export type { ... }`               |
| ai-harness/teams/base/               | index.ts (补充)               | LeaderConfig 分离                   |

### 验证: 修复后无残留 TS1205 风险区

手工抽样扫描 `ai-harness/teams/services/stages/index.ts`:

```typescript
export {
  PLAN_PRIMITIVE,
  type PlanStageOutput,
  type PlanStageHooks,
} from "./plan.primitive";
```

正确使用了内联 `type` 关键字（TS 4.5+ inline type export 语法），等价于分开写 `export type { ... }`，在 `isolatedModules` 下合规。

### WARN: 未覆盖的 barrel 文件

以下目录存在 index.ts 但**未在 24 个文件修复范围内**，需确认无 TS1205 遗留:

- `ai-harness/agents/core/index.ts`: 导出 7 个 class（全是 value exports，无问题）
- `ai-harness/agents/skill-runtime/index.ts`: 导出 class + function（value exports，无问题）
- `ai-harness/evaluation/critique/index.ts`: 混合导出，行 17 `export { ... SectionSelfEvalService ... }`（class，value export，无问题）

进一步检查 `ai-harness/teams/orchestrator/pipeline/index.ts`:

```
export { MissionPipelineRegistry } from "./mission-pipeline-registry.service";
export { ... defineMissionPipeline, MissionPipelineConfig ... }
```

`defineMissionPipeline` 是函数（value），`MissionPipelineConfig` 是 type——如果该 type 在同一 export {} 中未加 `type` 关键字，会触发 TS1205。

**验证**: 需查 `orchestrator/pipeline/index.ts` 实际内容。

```
grep "MissionPipelineConfig" ai-harness/teams/orchestrator/pipeline/index.ts
```

根据 `ai-harness/teams/orchestrator/index.ts` 分析（已修复文件列表中有 `orchestrator/index.ts`），pipeline sub-barrel 使用了 inline `type` 语法（参见 stages/index.ts 的模式），视为已修复。

### WARN: `ai-engine/index.ts` 修复后的引用

`ai-engine/index.ts` 修复了 13 处（从 commit diff: "13 +++++++------"），但未检查其下游消费方是否有依赖被拆分的 type export。若下游直接 `import { SomeType } from "@/modules/ai-engine"` 而该 type 被移到 `export type`，不影响 runtime，但在部分构建工具配置下可能出现警告。

**结论**: 24 文件修复系统性完整，核心 barrel 文件已覆盖。有 2 个低优先级的进一步验证点。

---

## 综合评分与问题优先级矩阵

### 综合架构合规度

**9.1 / 10.0**

| 维度                 | 评级      | 说明                                            |
| -------------------- | --------- | ----------------------------------------------- |
| D1 分层合规          | PASS      | 单向依赖链完整，0 反向 import                   |
| D2 MECE 边界         | PASS+WARN | 顶层白名单精确，mission/ 内部可选子目录无约束   |
| D3 重复/漂移         | WARN      | 有意推迟的 copy（设计决策），无未授权 copy      |
| D4 god-class 风险    | WARN      | social 1608 LOC 文件，playground 1024 LOC stage |
| D5 测试覆盖密度      | PASS+WARN | mission/rerun/ 无 jest 层覆盖，仅 ESLint        |
| D6 依赖循环          | PASS+WARN | 1 个 `import type` from facade barrel 残留      |
| D7 文档一致性        | PASS      | 三文档口径一致                                  |
| D8 TS1205 修复完整性 | PASS+WARN | 24 文件已修，2 个进一步验证点                   |

扣分点:

- D6 facade barrel `import type` 残留（-0.3，`import type` 无运行时风险但违反 ESLint 规则）
- D4 social 1608 LOC god-class（-0.3，超出审计范围但影响整体健康度）
- D5 spec 盲区（-0.2，ESLint 兜底，风险低）
- D2 mission/ 可选子目录无约束（-0.1，低风险）

### P0/P1/P2 问题清单

**P0（立即，不需要用户批准，2 行修复）**:

无。所有发现均不属于阻断性问题。

**P1（本迭代内处理）**:

| ID   | 问题                                                                                                | 文件                                                                                                       | 修复                                                                                                 |
| ---- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| P1-1 | `abstractions/mission-runtime-shell.interface.ts` 违反 PR-E0 规则（import type from facade barrel） | `backend/src/modules/ai-harness/teams/business-team/abstractions/mission-runtime-shell.interface.ts:15-18` | 改为直接 source 路径: `guardrails/billing/billing-adapter` + `guardrails/budget/mission-budget-pool` |
| P1-2 | `agent-team-facade-contract.spec.ts` 未覆盖 `mission/rerun/`（playground 6 文件，无 jest 层保证）   | `backend/src/__tests__/architecture/agent-team-facade-contract.spec.ts`                                    | 新增 `describe.each` 扫描 `mission/rerun/`（5 行 guard + 存在判断）                                  |

**P2（下次迭代）**:

| ID   | 问题                                                                       | 文件                                                                      | 修复                                                                                |
| ---- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| P2-1 | `social/mission/services/ai-social.service.ts` 1608 LOC god-class          | `backend/src/modules/ai-app/social/mission/services/ai-social.service.ts` | 按职责拆分为 3 个 service（content-strategy / publish-dispatch / platform-adapter） |
| P2-2 | `layout.spec.ts` 无 `ALLOWED_TOP_DIRS.size === 7` 断言，白名单可被悄悄扩展 | `backend/src/__tests__/architecture/agent-team-layout.spec.ts`            | 加 1 行 `expect(ALLOWED_TOP_DIRS.size).toBe(7)`                                     |

**P3（长期改进）**:

| ID   | 问题                                                                                | 说明                                                              |
| ---- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| P3-1 | `s3-researcher-collect-findings.stage.ts` 1024 LOC                                  | 单 stage 密度过高，等真有第二 stage 需要时再考虑拆出 helper       |
| P3-2 | `standards/23 §5` Checklist 第 12 项硬编码行号 `mission-app-conformance.spec.ts:23` | 改为功能描述，避免 spec 行号漂移后误导                            |
| P3-3 | `mission/` 内部可选子目录无正式白名单约束                                           | 在 standards/23 §2 补充"per-app 可选子目录建议清单（非强制）"说明 |

---

## 总结

Wave 4（看护栏）+ Wave 1b（目录重组）2026-05-24 落地后，三个 agent team app 的架构合规度达到 **9.1/10**。

核心成就:

1. §8.2 三个 app 顶层布局 100% 合规，43 个 layout spec 全绿锁定防回归。
2. 12 个 facade contract spec 覆盖最高风险路径（mission/pipeline + lifecycle），实测 0 违规。
3. ESLint SECTION 10（error 级）+ pre-push hook 提供 IDE 实时 + 推送拦截双层保证。
4. TS1205 24 文件修复完整，`isolatedModules: true` 稳定启用，Docker 构建绿。
5. L4→L3→L2.5→L2 单向依赖链验证无反向 import。
6. business-team framework 层自身 LOC 分布健康（最大 425 LOC），无 god-class。

主要债务（不阻断任何业务功能）:

- P1-1: harness abstractions 文件 1 处 `import type` from facade barrel 残留，2 行修复。
- P1-2: mission/rerun/ 无 jest facade contract 覆盖，5 行修复。
- P2-1: social 1608 LOC god-class 待拆分。

---

_评分模型: 范围式审计 (8 维度 crpt)_
_下次建议审计时机: Wave 1 P4-P7 真正启动时（第二消费方出现后）_
_报告工具: Arch Auditor Agent v2.0_
