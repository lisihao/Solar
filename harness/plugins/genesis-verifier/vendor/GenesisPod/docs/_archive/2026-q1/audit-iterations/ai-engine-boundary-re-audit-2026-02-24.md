# AI Engine 架构边界再审计报告

**审计日期**: 2026-02-24（初审同日，本次为整改后复核）
**对比基线**: `docs/audits/ai-engine-boundary-audit-2026-02-24.md`
**整改提交**: `b1965cd5`, `86264b82`, `21fb7b99`, `91173601`（共 4 个）

---

## 整改成果概览

| 项目                                   | 初审                        | 复核                      | 状态              |
| -------------------------------------- | --------------------------- | ------------------------- | ----------------- |
| F1: facade/index.ts 缺失 re-export     | 缺 17 个类型/类             | 已补 Registry+高频类型    | ✅ 完成           |
| F2: Facade 缺少 Registry getter        | 0 个                        | 已添加 5 个 getter        | ✅ 完成           |
| P4: ESLint 架构约束规则                | 无                          | 已添加，有白名单          | ✅ 基本完成       |
| V4 部分: mission-review 服务注入       | 2 个 orchestration 服务注入 | 已改用 facade getter      | ✅ 完成           |
| V4 部分: writing-agent-coordinator     | TeamFactory 直接注入        | 已改用 facade.teamFactory | ✅ 完成           |
| V1: module.ts Registry 注入            | 7 个 module 文件            | **未改**                  | ❌ 未整改         |
| V2: ToolRegistry 服务注入              | 12 个 service               | **未改**                  | ❌ 未整改（见注） |
| V3: TeamRegistry/RoleRegistry 服务注入 | 4 个 service                | 3 个 **未改**             | ⚠️ 部分           |
| V5: LongContentModule 冗余导入         | 1 处                        | **未改**                  | ❌ 未整改         |

**新发现问题**（初审未覆盖）：

| 项目                                                                  | 状态          |
| --------------------------------------------------------------------- | ------------- |
| N1: 12 个文件 TaskProfile 从 llm/types 导入（facade 已有，未迁移）    | ❌ 未整改     |
| N2: context-router.service.ts 对外 re-export orchestration 内部符号   | ❌ 未整改     |
| N3: ESLint 规则未覆盖 TaskProfile/TeamRegistry/ContextStrategy 等路径 | ⚠️ 覆盖不完整 |

---

## 一、已完成整改项详情

### F1 + F2 — Facade 补全（commit `21fb7b99`）

`facade/index.ts` 新增 17 项 re-export，`ai-engine.facade.ts` 新增 5 个 getter，**此为根因修复**：

```typescript
// facade/index.ts 新增（已验证）
export { ToolRegistry, AgentRegistry, TeamRegistry, RoleRegistry, SkillRegistry }
export type { TaskProfile, TeamConfig, ITeam, WorkflowConfig, ConstraintProfile, MissionEvent, ToolContext, ITool }
export { BUILTIN_ROLES, BUILTIN_TOOLS, createConstraintProfile }

// ai-engine.facade.ts 新增 getter（已验证，行 2894-2916）
get toolRegistry(): ToolRegistry | undefined
get agentRegistry(): AgentRegistry | undefined
get teamRegistry(): TeamRegistry | undefined
get roleRegistry(): RoleRegistry | undefined
get skillRegistry(): SkillRegistry | undefined
```

**评价**：基础设施已到位，消费方现在 _可以_ 从 facade 获取这些内容，但大多数消费方**尚未迁移**。

---

### V4 部分 — mission-review + writing-agent-coordinator（commit `b1965cd5`）

**mission-review.service.ts**：`OutputReviewerService` / `ContextEvolutionService` 服务注入已移除，改为通过 `this.aiFacade.outputReviewer` / `this.aiFacade.contextEvolution`。现仅剩：

```typescript
// 行 41 — 仅剩 TYPE-ONLY 导入（可接受）
import type {
  AiCallerFn,
  EstablishedFact,
} from "ai-engine/orchestration/services";
```

**writing-agent-coordinator.service.ts**：`TeamFactory` 直接注入已移除，改用 `facade.teamFactory`。`TeamRegistry` / `RoleRegistry` 仍直接导入（见 V3 残留）。

---

### P4 — ESLint 规则（commit `91173601`）

规则覆盖了以下高风险内部路径：

| 限制路径                                         | 强制方式                          |
| ------------------------------------------------ | --------------------------------- |
| `orchestration/services/intent-detection*`       | 必须用 facade.intentDetector      |
| `orchestration/services/output-reviewer*`        | 必须用 facade.outputReviewer      |
| `orchestration/services/context-evolution*`      | 必须用 facade.contextEvolution    |
| `orchestration/services/circuit-breaker*`        | 必须用 facade getter              |
| `orchestration/services/agent-executor*`         | 必须用 facade getter              |
| `teams/orchestrator/mission-orchestrator*`       | 必须用 facade.missionOrchestrator |
| `teams/factory/team-factory*`                    | 必须用 facade.teamFactory         |
| `long-content/services/long-content-engine*`     | 必须用 facade.longContentEngine   |
| `ai-engine/capabilities/*`                       | 必须用 facade                     |
| `ai-engine/realtime/**`                          | 必须用 facade                     |
| `ai-engine/memory/stores/*`                      | 必须用 facade                     |
| `ai-engine/content-fetch/content-fetch.service*` | 必须用 facade.contentFetch        |

白名单豁免（正确）：`*.agent.ts`、`*.config.ts`、`*.skill.ts`、`common/*.service.ts`

---

## 二、未整改项详情

### V1 — module.ts Registry 注入（7 个，全部未动）

下列 module 文件均在 `onModuleInit` 中直接注入并使用 Registry，且 import 路径仍为内部路径：

| 文件                                                     | Registry                         | import 路径 |
| -------------------------------------------------------- | -------------------------------- | ----------- |
| `ai-app/teams/ai-teams.module.ts:73-74`                  | `TeamRegistry` + `AgentRegistry` | 内部路径    |
| `ai-app/research/research.module.ts:13-14`               | `AgentRegistry` + `TeamRegistry` | 内部路径    |
| `ai-app/office/ai-office.module.ts:48`                   | `TeamRegistry`                   | 内部路径    |
| `ai-app/image/ai-image.module.ts:12`                     | `AgentRegistry`                  | 内部路径    |
| `ai-app/planning/ai-planning.module.ts:20`               | `TeamRegistry`                   | 内部路径    |
| `ai-app/simulation/ai-simulation.module.ts:11`           | `AgentRegistry`                  | 内部路径    |
| `ai-app/office/slides/skills/slides-skills.module.ts:26` | `SkillRegistry`                  | 内部路径    |

**说明**：这些文件注入 Registry 是合规行为（CLAUDE.md 允许通过 Registry 访问），但 **import 路径仍指向内部模块**，应改为从 `ai-engine/facade` 导入（facade/index.ts 已提供 re-export）。ESLint 规则未限制 Registry 的导入路径，因此无法自动发现。

---

### V2 — ToolRegistry 服务注入（12 个，全部保留）

下列服务仍直接注入 `ToolRegistry`（import 路径为内部路径）：

```
teams/services/ai/ai-response.service.ts
teams/services/collaboration/mission/mission-execution.service.ts
teams/services/collaboration/mission/team-mission.service.ts
teams/agents/team-member.agent.ts
topic-insights/services/data/data-enrichment.service.ts
topic-insights/services/data/data-source-fetcher.service.ts
topic-insights/services/data/data-source-router.service.ts
topic-insights/services/data/leader-tool.service.ts
topic-insights/services/report/figure-extractor.service.ts
research/discussion/iterative-search.service.ts
research/project/research-project-source.service.ts
office/slides/skills/data-supplement.skill.ts
```

**说明**：整改 Agent 在 ESLint commit 中明确注释 "Remove incorrect ToolRegistry restriction (Registry access is allowed per CLAUDE.md architecture)"，认定直接注入 Registry 为合规。**此判断部分正确**：

- 注入 Registry ✅ 合规（CLAUDE.md 许可）
- 但 **import 路径**仍为 `ai-engine/tools/registry/tool.registry`（内部路径），应改为从 `ai-engine/facade` 导入 ❌

---

### V3 — TeamRegistry/RoleRegistry 服务注入（3 个，未改）

| 文件                                                                  | 注入内容                        | 状态             |
| --------------------------------------------------------------------- | ------------------------------- | ---------------- |
| `writing/services/mission/writing-mission.service.ts:36-37`           | `TeamRegistry` + `RoleRegistry` | 仍从内部路径导入 |
| `writing/services/mission/writing-agent-coordinator.service.ts:10-11` | `TeamRegistry` + `RoleRegistry` | 仍从内部路径导入 |
| `teams/services/integration/ai-teams-integration.service.ts:14-15`    | `TeamRegistry` + `RoleRegistry` | 仍从内部路径导入 |

**说明**：`b1965cd5` 提交说 writing-mission 修复了 "4 engine injections"，但 TeamRegistry/RoleRegistry 注入**未被触及**，仍保留。

---

### V4 残留 — orchestration 具体值导入（4 个文件，部分新发现）

以下为非 type-only 的具体值导入，且 facade/index.ts 未提供对应 re-export：

| 文件                                                                  | 导入内容                                              | 说明                                                            |
| --------------------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------- |
| `teams/services/ai/context-router.service.ts`                         | `UserIntent`, `ContextStrategy`（具体值 + re-export） | `UserIntent` 已在 facade，`ContextStrategy` 未在 facade         |
| `teams/services/collaboration/mission/task-breakdown.service.ts:25`   | `TeamMemberInfo`                                      | 具体类型，facade 未 re-export                                   |
| `teams/services/collaboration/mission/mission-state.manager.ts:12-15` | `StateCategory`, `ExecutionStateStats`                | 具体值，facade 未 re-export，state-machine 路径未受 ESLint 约束 |
| `teams/services/collaboration/utils/retry.utils.ts:26`                | `DEFAULT_RETRY_CONFIG as AI_ENGINE_RETRY_CONFIG`      | 具体值，orchestration/utils 未受约束                            |

以下为 type-only 导入（已可接受，但 import 路径仍为内部路径）：

| 文件                                                                     | 导入内容                                                      |
| ------------------------------------------------------------------------ | ------------------------------------------------------------- |
| `teams/services/ai/context-compression.service.ts`                       | `import type { CompressionResult, CompressionOptions }`       |
| `teams/services/collaboration/context/constraint-enforcement.service.ts` | `import type { ConstraintViolation, OutputValidationResult }` |
| `teams/services/collaboration/context/token-budget.service.ts`           | `import type { ContentPriority, BudgetAllocation }`           |
| `teams/services/collaboration/mission/mission-execution.service.ts`      | `import type { TaskProfile }`                                 |

---

### V5 — LongContentModule 冗余导入（未改）

`ai-app/writing/ai-writing.module.ts:14,113` 仍直接导入 `LongContentModule`，而 `AiEngineModule` 已在 `:216` export 该模块，此导入为冗余。

---

## 三、新发现问题

### N1 — TaskProfile 从 `llm/types` 导入（12 个文件，facade 已有未迁移）

`facade/index.ts` 在 `21fb7b99` 中已添加 `export type { TaskProfile } from "../llm/types"`，但以下 12 个文件**仍使用旧路径**：

```
image/analytics/analytics.service.ts
image/generation/prompt-enhancement.service.ts
teams/services/collaboration/mission/mission-ai-caller.service.ts
teams/services/collaboration/mission/mission-execution.service.ts (type-only)
writing/agents/bible-keeper.agent.ts
writing/agents/consistency-checker.agent.ts
writing/agents/editor.agent.ts
writing/agents/story-architect.agent.ts
writing/services/consistency/chapter-coherence.service.ts
writing/services/quality/expression-alternatives.service.ts
writing/services/quality/narrative-craft.service.ts
writing/services/quality/semantic-consistency.service.ts
```

**说明**：`*.agent.ts` 文件在 ESLint 白名单中，ESLint 不会捕获。其余文件无法被 ESLint 拦截，因为 `llm/types` 路径未被限制。

---

### N2 — context-router.service.ts 对外 re-export 内部符号

`context-router.service.ts` 不仅导入，还**re-export** 了 orchestration 内部符号：

```typescript
// teams/services/ai/context-router.service.ts
export {
  UserIntent,
  ContextStrategy,
} from "../../../../ai-engine/orchestration/services";
```

这使 `context-router` 成为 orchestration 内部符号的**二次分发点**，其他模块可能通过 `context-router` 间接引用内部路径，而非 facade。`ContextStrategy` 未在 facade/index.ts 中 re-export。

---

### N3 — ESLint 规则覆盖不完整

当前规则仅限制特定命名的 orchestration service 文件，以下高风险路径**无 ESLint 保护**：

| 未受保护的路径                                | 现有违规文件数 |
| --------------------------------------------- | -------------- |
| `ai-engine/orchestration/state-machine`       | 1              |
| `ai-engine/orchestration/utils/*`             | 1              |
| `ai-engine/orchestration/services/interfaces` | 1              |
| `ai-engine/llm/types`                         | 10             |
| `ai-engine/teams/registry/*`（import 路径）   | 7              |
| `ai-engine/tools/registry/*`（import 路径）   | 12             |
| `ai-engine/long-content`（module 层级）       | 1              |

---

## 四、量化对比

| 指标                                | 初审       | 复核       | 变化 |
| ----------------------------------- | ---------- | ---------- | ---- |
| 违规文件总数（非豁免）              | 31         | 29         | -2   |
| 具体服务注入违规数                  | 24 service | 22 service | -2   |
| module.ts 违规数                    | 7          | 7          | 0    |
| Facade getter 数量                  | 20+        | 25+        | +5   |
| facade/index.ts re-export 数        | 12         | 29         | +17  |
| ESLint 规则覆盖路径数               | 0          | 12         | +12  |
| import 路径已迁移到 facade 的文件数 | —          | ≈3         | —    |

---

## 五、修复优先级（剩余）

### P0 — Import 路径统一（低风险，高一致性收益）

Facade 的 re-export 已就绪，现在只需将现有文件的 import 路径从内部路径改为 facade 路径。**功能不变，仅改路径**：

**批次 1**（V1 + V3 — Registry 路径统一）：
将 7 个 `*.module.ts` + 3 个 service 中的：

```typescript
// 改前
import { TeamRegistry } from "../../ai-engine/teams/registry/team-registry";
import { AgentRegistry } from "../../ai-engine/agents/registry";
// 改后
import { TeamRegistry, AgentRegistry } from "../../ai-engine/facade";
```

**批次 2**（V2 — ToolRegistry 路径统一，12 个文件）：

```typescript
// 改前
import { ToolRegistry } from "@/modules/ai-engine/tools/registry/tool.registry";
// 改后
import { ToolRegistry } from "@/modules/ai-engine/facade";
```

**批次 3**（N1 — TaskProfile 路径统一，12 个文件，agent 文件豁免）：

```typescript
// 改前
import { TaskProfile } from "@/modules/ai-engine/llm/types";
// 改后
import type { TaskProfile } from "@/modules/ai-engine/facade";
```

---

### P1 — 补全 facade/index.ts 剩余缺失导出

```typescript
export { ContextStrategy } from "../orchestration/services"; // N2
export { TeamMemberInfo } from "../orchestration/services/interfaces"; // V4
export {
  StateCategory,
  ExecutionStateStats,
} from "../orchestration/state-machine"; // V4
export { DEFAULT_RETRY_CONFIG } from "../orchestration/utils/error-detection.utils"; // V4
```

---

### P2 — 删除 LongContentModule 冗余导入（V5）

`ai-writing.module.ts:14,113` 删除 `LongContentModule` 导入行。

---

### P3 — 补全 ESLint 覆盖路径（N3）

在现有规则基础上补充：

```js
{
  group: ["**/ai-engine/orchestration/state-machine*"],
  message: "Use facade.execStateManager instead."
},
{
  group: ["**/ai-engine/orchestration/utils/*"],
  message: "Move retry/error-detection utilities to facade re-exports."
},
{
  group: ["**/ai-engine/llm/types*", "**/ai-engine/llm/types/**"],
  message: "Import TaskProfile and LLM types from ai-engine/facade."
},
```

---

### P4 — 处理 context-router.service 对外 re-export（N2）

将 `context-router.service.ts` 中的 re-export 改为从 facade 转发：

```typescript
// 改前
export {
  UserIntent,
  ContextStrategy,
} from "../../../../ai-engine/orchestration/services";
// 改后
export { UserIntent } from "../../../../ai-engine/facade";
// ContextStrategy 先在 facade/index.ts 补充 re-export
export { ContextStrategy } from "../../../../ai-engine/facade";
```

---

## 六、总结评价

**整改 Agent 做对了：**

- 精准修复了 Facade 基础设施缺失（F1、F2）—— 这是根本解法
- 添加了 ESLint 防护层，覆盖最高风险的 orchestration 服务注入
- 修复了 mission-review 和 writing-agent-coordinator 中的具体服务注入

**整改 Agent 的认知偏差：**

- 将"Registry 注入合规"等同于"从任意路径导入 Registry 合规"。实际上，注入合规，但 import 路径应统一到 facade，否则 facade/index.ts 的 re-export 形同虚设
- 4 个提交修改了 15 个文件，但核心量大的 V1（7 个 module）、V2（12 个 service）的路径迁移未启动

**剩余工作量评估：**
P0 三批次路径迁移（约 27 个文件）+ P1（4 行 facade 补充）+ P2（2 行删除）+ P3（ESLint 补充）= 机械性改动为主，约 2-3 小时，无逻辑风险。

---

_本报告所有数据均通过 grep 全量扫描 + 关键文件逐行阅读验证。_

