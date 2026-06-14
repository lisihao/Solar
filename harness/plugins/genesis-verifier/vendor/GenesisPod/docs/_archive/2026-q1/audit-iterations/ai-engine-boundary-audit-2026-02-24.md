# AI Engine 架构边界审计报告

**审计日期**: 2026-02-24
**审计范围**: `backend/src/modules/ai-app/` 对 `backend/src/modules/ai-engine/` 的引用
**审计方法**: 逐文件代码阅读 + grep 全量扫描（非 Sub-Agent 估算）
**架构约束来源**: `CLAUDE.md` — "所有 AI App 模块只通过 `AIEngineFacade` 和 Registry 访问 AI Engine，禁止直接导入 Engine 内部服务"

---

## 执行摘要

在 `ai-app/` 层的全量扫描中，共发现 **4 类违规模式**，涉及 **7 个模块文件**和 **24 个服务文件**。根本原因是 `AIEngineFacade` 未暴露 Registry getter，导致消费方被迫直接注入；以及 `facade/index.ts` 缺失高频类型的 re-export，导致消费方绕道访问内部路径。

违规归类如下：

| 违规类型                                         | 文件数          | 严重程度 |
| ------------------------------------------------ | --------------- | -------- |
| V1：模块 `onModuleInit` 直接注入 Registry        | 7 个 .module.ts | HIGH     |
| V2：服务层直接注入 `ToolRegistry`                | 12 个 service   | HIGH     |
| V3：服务层直接注入 `TeamRegistry`/`RoleRegistry` | 4 个 service    | HIGH     |
| V4：服务层直接 import `orchestration/` 内部服务  | 8 个 service    | MEDIUM   |

另发现 1 处冗余导入（V5）及 Facade 本身的不完整问题（F1）。

---

## 违规清单

### V1 — 模块 `onModuleInit` 直接注入 Registry

**问题**：7 个 App 模块在 `onModuleInit` 中需要向 Registry 注册 Agent/Team/Skill，因 Facade 无对应 getter，被迫直接注入 Engine 内部 Registry 类。

| 文件                                                     | 注入的 Registry                  | 用途                                              |
| -------------------------------------------------------- | -------------------------------- | ------------------------------------------------- |
| `ai-app/teams/ai-teams.module.ts:73-74,172-180`          | `TeamRegistry` + `AgentRegistry` | 注册 DEBATE_TEAM_CONFIG 和 TeamCollaborationAgent |
| `ai-app/research/research.module.ts:13-14,65-73`         | `AgentRegistry` + `TeamRegistry` | 注册 ResearcherAgent 和 RESEARCH_TEAM_CONFIG      |
| `ai-app/office/ai-office.module.ts:48,118,120`           | `TeamRegistry`                   | 注册 Office 相关 Team 配置                        |
| `ai-app/image/ai-image.module.ts:12,106,110-112`         | `AgentRegistry`                  | 注册 ImageDesignerAgent                           |
| `ai-app/planning/ai-planning.module.ts:20,31,33`         | `TeamRegistry`                   | 注册 PLANNING_TEAM_CONFIG                         |
| `ai-app/simulation/ai-simulation.module.ts:11,35,39-41`  | `AgentRegistry`                  | 注册 SimulatorAgent                               |
| `ai-app/office/slides/skills/slides-skills.module.ts:26` | `SkillRegistry`                  | 注册 Slides Skill 集合                            |

**根因**：`AIEngineFacade` 无 `get agentRegistry()` / `get teamRegistry()` / `get roleRegistry()` / `get skillRegistry()` getter。

---

### V2 — 服务层直接注入 `ToolRegistry`

**问题**：12 个服务文件绕过 Facade，直接从 `ai-engine/tools/registry/tool.registry` 注入 `ToolRegistry` 来调用工具。这些调用绕过了 Facade 层的计费追踪和能力路由。

| 文件                                                                   | 路径                                     |
| ---------------------------------------------------------------------- | ---------------------------------------- |
| `teams/services/ai/ai-response.service.ts:11`                          | `ai-engine/tools/registry/tool.registry` |
| `teams/services/collaboration/mission/mission-execution.service.ts:25` | `ai-engine/tools/registry/tool.registry` |
| `teams/services/collaboration/mission/team-mission.service.ts:20`      | `ai-engine/tools/registry/tool.registry` |
| `teams/agents/team-member.agent.ts:11`                                 | `ai-engine/tools/registry`               |
| `topic-insights/services/data/data-enrichment.service.ts:18`           | `ai-engine/tools/registry/tool.registry` |
| `topic-insights/services/data/data-source-fetcher.service.ts:2`        | `ai-engine/tools/registry/tool.registry` |
| `topic-insights/services/data/data-source-router.service.ts:22`        | `ai-engine/tools/registry/tool.registry` |
| `topic-insights/services/data/leader-tool.service.ts:20`               | `ai-engine/tools/registry/tool.registry` |
| `topic-insights/services/report/figure-extractor.service.ts:2`         | `ai-engine/tools/registry/tool.registry` |
| `research/discussion/iterative-search.service.ts:3`                    | `ai-engine/tools/registry/tool.registry` |
| `research/project/research-project-source.service.ts:10`               | `ai-engine/tools/registry/tool.registry` |
| `office/slides/skills/data-supplement.skill.ts:18`                     | `ai-engine/tools/registry/tool.registry` |

**根因**：`AIEngineFacade` 无 `get toolRegistry()` getter，ToolRegistry 只封装在内部 `TOOL_FEATURE` token 中，对外不可见。

---

### V3 — 服务层直接注入 `TeamRegistry` / `RoleRegistry`

**问题**：4 个服务在业务逻辑中直接持有 Registry 引用，不是注册时的临时操作，而是运行时查询/操作。

| 文件                                                            | 注入的 Registry                 | 行号           |
| --------------------------------------------------------------- | ------------------------------- | -------------- |
| `teams/services/integration/ai-teams-integration.service.ts`    | `TeamRegistry` + `RoleRegistry` | 14-15          |
| `writing/services/mission/writing-mission.service.ts`           | `TeamRegistry` + `RoleRegistry` | 36-37, 211-214 |
| `writing/services/mission/writing-agent-coordinator.service.ts` | `TeamRegistry` + `RoleRegistry` | 10-11, 59-60   |
| `office/slides/orchestrator/slides-team-member.ts`              | `SkillRegistry`                 | 8              |

**根因**：同 V1，Facade 未暴露 Registry getter。

---

### V4 — 服务层直接 import `orchestration/` 内部服务

**问题**：8 个文件直接从 `ai-engine/orchestration/` 内部路径导入具体服务，这些服务并未在 Facade 中以 getter 形式对外暴露。

| 文件                                                                        | 导入路径                                              | 导入内容                       |
| --------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------ |
| `teams/services/ai/context-compression.service.ts:19`                       | `ai-engine/orchestration/services`                    | `ContextCompressionService` 等 |
| `teams/services/ai/context-router.service.ts:24,30`                         | `ai-engine/orchestration/services`                    | 多个 Orchestration 服务        |
| `teams/services/ai/ai-response.service.ts:20`                               | `ai-engine/orchestration/executors`                   | `AgentEvent`                   |
| `teams/services/collaboration/context/constraint-enforcement.service.ts:19` | `ai-engine/orchestration/services`                    | `ConstraintEnforcementService` |
| `teams/services/collaboration/context/token-budget.service.ts:17`           | `ai-engine/orchestration/services`                    | `TokenBudgetService`           |
| `teams/services/collaboration/mission/mission-review.service.ts:41`         | `ai-engine/orchestration/services`                    | `OutputReviewerService` 等     |
| `teams/services/collaboration/mission/mission-state.manager.ts:15`          | `ai-engine/orchestration/state-machine`               | `ExecutionStateManager`        |
| `teams/services/collaboration/utils/retry.utils.ts:26`                      | `ai-engine/orchestration/utils/error-detection.utils` | `ErrorDetectionUtils`          |

**备注**：`mission-review.service.ts` 和 `mission-state.manager.ts` 已在 Facade 中新增对应 getter（`outputReviewer`, `execStateManager`），但导入路径尚未迁移。

---

### V5 — 冗余子模块直接导入（低严重度）

| 文件                                  | 冗余导入            | 说明                                                                            |
| ------------------------------------- | ------------------- | ------------------------------------------------------------------------------- |
| `writing/ai-writing.module.ts:14,113` | `LongContentModule` | `AiEngineModule` 已在 `:216` export `LongContentModule`，Writing 再次导入属冗余 |

---

## Facade 自身问题

### F1 — `facade/index.ts` 缺少高频类型 re-export

以下类型在 App 层被大量使用，但 `facade/index.ts` 未收录，导致 App 层被迫使用内部路径。

**Registry 类（V1/V3 的根因之一）**：

| 缺失导出        | 内部路径                         | 被使用次数 |
| --------------- | -------------------------------- | ---------- |
| `TeamRegistry`  | `teams/registry/team-registry`   | 7 处       |
| `AgentRegistry` | `agents/registry`                | 5 处       |
| `RoleRegistry`  | `teams/registry/role-registry`   | 4 处       |
| `SkillRegistry` | `skills/registry/skill.registry` | 2 处       |

**Teams 抽象类型**：

| 缺失导出                     | 内部路径                                | 被使用次数 |
| ---------------------------- | --------------------------------------- | ---------- |
| `ITeamConfig` / `TeamConfig` | `teams/abstractions/team.interface`     | 3+ 处      |
| `WorkflowConfig`             | `teams/abstractions/workflow.interface` | 3+ 处      |
| `ConstraintProfile`          | `teams/constraints`                     | 3+ 处      |
| `BUILTIN_ROLES`              | `teams/abstractions/role.interface`     | 3+ 处      |
| `BUILTIN_TOOLS`              | `core/types/agent.types`                | 4+ 处      |
| `createConstraintProfile`    | `teams/constraints/constraint-profile`  | 3+ 处      |
| `MissionEvent`               | `teams/abstractions/mission.interface`  | 2+ 处      |

**LongContent 类型**：

| 缺失导出                                           | 内部路径                  | 被使用次数 |
| -------------------------------------------------- | ------------------------- | ---------- |
| `LongContentProjectConfig`, `TaskExecutionContext` | `long-content`            | 1 处       |
| `GranularityLevel`                                 | `long-content/interfaces` | 1 处       |

**其他**：

| 缺失导出      | 内部路径                            | 被使用次数                                 |
| ------------- | ----------------------------------- | ------------------------------------------ |
| `TaskProfile` | `llm/types`                         | 8+ 处（writing/teams/image/research 均有） |
| `ToolContext` | `tools/abstractions/tool.interface` | 4+ 处                                      |
| `AgentEvent`  | `orchestration/executors`           | 1 处                                       |

### F2 — Facade 未暴露 Registry getter

`AIEngineFacade` 有 20+ 个服务 getter（`longContentEngine`, `embeddingService`, `teamFactory` 等），但无以下 getter：

- `get toolRegistry(): ToolRegistry`
- `get agentRegistry(): AgentRegistry`
- `get teamRegistry(): TeamRegistry`
- `get roleRegistry(): RoleRegistry`
- `get skillRegistry(): SkillRegistry`

这是 V1/V2/V3 的直接根因。Facade 内部已通过 `TOOL_FEATURE` 持有 `ToolRegistry` 引用（`this.tools?.registry`），暴露 getter 的代价极低。

---

## 豁免项（不视为违规）

以下模式经确认属于架构设计许可范围，不计入违规：

| 模式                                      | 涉及文件                                                                             | 理由                                             |
| ----------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------ |
| Agent 继承 `BaseAgent` / `PlanBasedAgent` | `writing/agents/*.ts`, `research/agents/*.ts`, `image/agents/*.ts`                   | 继承关系是架构设计要求                           |
| Team 配置文件 import 抽象接口             | `teams/teams/*.config.ts`, `office/teams/*.config.ts`, `planning/config/*.config.ts` | 配置对象定义必须引用接口，属于不可避免的类型依赖 |
| Re-export wrapper                         | `office/common/content-analysis.service.ts`, `rag/services/rag-pipeline.service.ts`  | 显式适配层，非绕道                               |
| `AiEngineModule` 导入语句                 | 所有 `.module.ts`                                                                    | 正确的模块依赖方式                               |

---

## 修复优先级

### P0（直接根因，一次修复解决多处违规）

**在 `ai-engine/facade/ai-engine.facade.ts` 添加 Registry getter**：

```typescript
get toolRegistry(): ToolRegistry | undefined {
  return this.tools?.registry;
}
get agentRegistry(): AgentRegistry | undefined {
  return this.agentRegistrySvc;
}
get teamRegistry(): TeamRegistry | undefined {
  return this.teamsSvc?.teamRegistry; // 视内部结构确认
}
get roleRegistry(): RoleRegistry | undefined {
  return this.roleRegistrySvc;
}
get skillRegistry(): SkillRegistry | undefined {
  return this.skillRegistrySvc;
}
```

预计可消除：V1 全部 7 处 + V2 全部 12 处 + V3 全部 4 处。

---

### P1（补完 Facade 重导出）

**在 `ai-engine/facade/index.ts` 补充**：

```typescript
// Registry classes
export { ToolRegistry } from "../tools/registry/tool.registry";
export { AgentRegistry } from "../agents/registry";
export { TeamRegistry } from "../teams/registry/team-registry";
export { RoleRegistry } from "../teams/registry/role-registry";
export { SkillRegistry } from "../skills/registry/skill.registry";

// Teams abstractions
export type {
  ITeamConfig,
  TeamConfig,
} from "../teams/abstractions/team.interface";
export type { WorkflowConfig } from "../teams/abstractions/workflow.interface";
export type { ConstraintProfile } from "../teams/constraints";
export { BUILTIN_ROLES } from "../teams/abstractions/role.interface";
export { BUILTIN_TOOLS } from "../core/types/agent.types";
export { createConstraintProfile } from "../teams/constraints/constraint-profile";
export type { MissionEvent } from "../teams/abstractions/mission.interface";

// LLM types
export type { TaskProfile } from "../llm/types";

// Tool types
export type { ToolContext } from "../tools/abstractions/tool.interface";
```

---

### P2（迁移已有 Facade getter 的调用方）

`mission-review.service.ts` 和 `mission-state.manager.ts` 导入的 `OutputReviewerService`/`ExecutionStateManager` 已在 Facade 中有 getter，应改为通过 `aiEngineFacade.outputReviewer` / `aiEngineFacade.execStateManager` 访问，不再直接从 orchestration 内部路径导入。

---

### P3（删除冗余导入）

删除 `ai-writing.module.ts:14,113` 中的 `LongContentModule` 导入（V5）。

---

### P4（长期防护）

在 `.eslintrc.js` 添加规则，CI 阶段自动拦截对 `ai-engine/` 内部路径的直接导入：

```js
"no-restricted-imports": ["error", {
  patterns: [{
    group: [
      "**/ai-engine/!(facade|index)*",
      "**/ai-engine/!(facade|index)*/**"
    ],
    message: "请从 ai-engine/facade 或 ai-engine/index 导入，禁止访问 Engine 内部路径"
  }]
}]
```

白名单例外（通过 `overrides`）：

- `**/agents/*.agent.ts` — 允许继承 `BaseAgent`/`PlanBasedAgent`
- `**/*.config.ts` — 允许 Team 配置文件使用抽象接口

---

## 数据统计

| 指标                              | 数值                        |
| --------------------------------- | --------------------------- |
| 扫描的 ai-app 模块数              | 11                          |
| 发现违规文件数                    | 31（7 module + 24 service） |
| V1 违规点数                       | 7                           |
| V2 违规点数                       | 12                          |
| V3 违规点数                       | 4                           |
| V4 违规点数                       | 8                           |
| 豁免文件数                        | ~20                         |
| Facade 缺失 getter 数             | 5                           |
| facade/index.ts 缺失 re-export 数 | ~18 个类型/类               |

---

_本报告基于源码直读，所有行号引用均经人工验证。_

