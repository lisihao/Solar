# 架构合规审计报告

**执行日期**: 2026-02-24
**审计范围**: `backend/src/modules/ai-app/` + `backend/src/modules/ai-engine/`
**审计员**: Claude Code (Sonnet 4.6)

---

## 执行摘要

| 规则                                          | 违规数                                  | 严重等级 |
| --------------------------------------------- | --------------------------------------- | -------- |
| A: Facade 边界（ai-app → ai-engine 内部路径） | 180 条（96 条在非豁免文件中）           | P0       |
| B: 反向依赖（ai-engine → ai-app）             | 0 条                                    | -        |
| C: LLM 硬编码（temperature/maxTokens 直接值） | 3 条（ai-engine 内部）                  | P1       |
| D: 注册模式缺失                               | 2 个模块（ask、rag 无注册逻辑，但合理） | P2       |
| E: console.log 使用                           | 1 条实际违规（social/utils）            | P2       |
| E: any 类型                                   | ai-app 112 处、ai-engine 40 处          | P1       |
| E: 硬编码品牌名（字符串字面量）               | 1 条（DeepDive 在示例数据中）           | P3       |
| ESLint 覆盖缺口                               | 18 个 ai-engine 子目录未覆盖            | P1       |

### 架构健康评分

```
总分: 52 / 100

扣分明细:
  - Facade 边界违规 180 条（96 条在执行路径中）: -30 分
  - ESLint 18 个目录未覆盖（护栏不完整）: -10 分
  - any 类型 152 处: -5 分
  - LLM 硬编码 3 处（均在 ai-engine 内部）: -2 分
  - console.log 1 处: -1 分

加分项:
  + 反向依赖: 0 违规（满分）
  + onModuleInit 注册模式: 所有有 Agent/Team 的模块均已实现
  + 品牌硬编码: 仅 1 处示例数据
```

---

## 第一章：Facade 边界违规（规则 A）

### 概述

共发现 **180 条** import 语句违反 Facade 边界原则。
其中 **84 条**位于 ESLint `excludedFiles` 豁免的文件中（`*.agent.ts`、`*.config.ts`、`*.skill.ts`、`common/*.service.ts`），但这些豁免本身存在争议（见第四章）。
**96 条**位于非豁免文件，属于无条件违规。

### 违规按 ai-app 子模块分组

---

#### 1.1 ask 模块（1 条）

| 文件                    | 行  | 违规 import                                                           | 修复建议                                                                                     |
| ----------------------- | --- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `ask/adapters/index.ts` | 9   | `from "../../../ai-engine/llm/adapters/function-calling-llm.adapter"` | 将 `FunctionCallingLLMAdapter` 加入 `facade/index.ts` 导出，或通过 `AIEngineFacade` 方法调用 |

---

#### 1.2 image 模块（9 条）

| 文件                                             | 行  | 违规 import                                                               | 修复建议                                                                 |
| ------------------------------------------------ | --- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `image/ai-image.module.ts`                       | 10  | `from "../../ai-engine/tools/abstractions/generation-services.interface"` | `IMAGE_GENERATION_SERVICE` 令牌应从 facade 导出                          |
| `image/ai-image.module.ts`                       | 11  | `from "../../ai-engine/interfaces/image.interface"`                       | `IMAGE_GENERATION_SERVICE_TOKEN` 从 facade 导出                          |
| `image/ai-image.module.ts`                       | 12  | `from "../../ai-engine/agents/registry"`                                  | 改为 `from "../../ai-engine/facade"` — `AgentRegistry` 已在 facade 导出  |
| `image/analytics/analytics.service.ts`           | 4   | `from "../../../ai-engine/llm/types"`                                     | `TaskProfile` 已在 facade 导出，改为 `from "../../../ai-engine/facade"`  |
| `image/generation/imagen4-prompt.service.ts`     | 16  | `from "../../../ai-engine/teams/abstractions/mission.interface"`          | `MissionEvent` 已在 facade 导出，改为 `from "../../../ai-engine/facade"` |
| `image/generation/prompt-enhancement.service.ts` | 10  | `from "../../../ai-engine/llm/types"`                                     | 同上，使用 facade 导出的 `TaskProfile`                                   |
| `image/agents/image-designer.agent.ts`           | 18  | `from "../../../ai-engine/agents/base/plan-based-agent"`                  | 豁免文件（\*.agent.ts），但应评估是否需要专项豁免条款                    |
| `image/agents/image-designer.agent.ts`           | 22  | `from "../../../ai-engine/core/types/agent.types"`                        | `BUILTIN_TOOLS` 已在 facade 导出                                         |
| `image/agents/image-designer.agent.ts`           | 26  | `from "../../../ai-engine/interfaces/image.interface"`                    | 将 image 接口加入 facade 导出                                            |

---

#### 1.3 office 模块（26 条）

| 文件                                                     | 行     | 违规 import                                                                                       | 修复建议                                                                                                       |
| -------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `office/ai-office.module.ts`                             | 48     | `from "../../ai-engine/teams/registry/team-registry"`                                             | `TeamRegistry` 已在 facade 导出，改为 facade 路径                                                              |
| `office/common/content-analysis.service.ts`              | 7      | `from "../../../ai-engine/content-analysis"`                                                      | 将 `ContentAnalysisService` 加入 facade 导出（豁免文件）                                                       |
| `office/common/content-analysis.types.ts`                | 7      | `from "../../../ai-engine/content-analysis/content-analysis.types"`                               | 将类型加入 facade 导出                                                                                         |
| `office/common/image-matching.service.ts`                | 11     | `from "../../../ai-engine/image/matching"`                                                        | 豁免文件，将 ImageMatchingService 加入 facade（豁免文件）                                                      |
| `office/common/template-selection.types.ts`              | 21,27  | `from "../../../ai-engine/image/matching/image-matching.types"`                                   | 将 image-matching 类型加入 facade 导出                                                                         |
| `office/slides/orchestrator/slides-team-member.ts`       | 8      | `from "@/modules/ai-engine/skills/registry/skill.registry"`                                       | `SkillRegistry` 已在 facade 导出，改为 facade 路径                                                             |
| `office/slides/orchestrator/slides-team-orchestrator.ts` | 34     | `from "@/modules/ai-engine/skills"`                                                               | 从 facade 导入所需类型                                                                                         |
| `office/slides/orchestrator/types.ts`                    | 8      | `from "@/modules/ai-engine/skills"`                                                               | 将 `ISkillOutputManager` 加入 facade 导出                                                                      |
| `office/slides/services/ai-edit.service.ts`              | 34     | `from "@/modules/ai-engine/skills/abstractions/skill.interface"`                                  | 将 `SkillContext` 加入 facade 导出                                                                             |
| `office/slides/skills/slides-skills.module.ts`           | 26,27  | `from "@/modules/ai-engine/skills/registry/skill.registry"` / `skills/runtime`                    | `SkillRegistry` 和 `PromptSkillBridge` 均已在 facade 导出                                                      |
| `office/slides/skills/*.skill.ts` (多个)                 | 各一条 | `from "@/modules/ai-engine/skills"` 或 `skills/abstractions/skill.interface`                      | 豁免文件（\*.skill.ts），但这 9 个文件共引用了 9 条直接路径                                                    |
| `office/slides/skills/data-supplement.skill.ts`          | 18,19  | `from "../../../../ai-engine/tools/registry/tool.registry"` / `tools/abstractions/tool.interface` | 豁免文件；`ToolRegistry` 和 `ToolContext` 已在 facade 导出                                                     |
| `office/teams/report-team.config.ts`                     | 12-16  | 5 条 teams/abstractions、teams/constraints、core/types                                            | 豁免文件；BUILTIN_ROLES、BUILTIN_TOOLS、TeamConfig、WorkflowConfig、createConstraintProfile 均已在 facade 导出 |
| `office/teams/slides-team.config.ts`                     | 19-23  | 同上 5 条                                                                                         | 同上                                                                                                           |
| `office/teams/visual-design-team.config.ts`              | 20-24  | 同上 5 条                                                                                         | 同上                                                                                                           |

---

#### 1.4 planning 模块（6 条）

| 文件                                      | 行  | 违规 import                                            | 修复建议                                               |
| ----------------------------------------- | --- | ------------------------------------------------------ | ------------------------------------------------------ |
| `planning/ai-planning.module.ts`          | 20  | `from "../../ai-engine/teams/registry/team-registry"`  | `TeamRegistry` 已在 facade 导出，改为 facade 路径      |
| `planning/config/planning-team.config.ts` | 5-9 | 5 条 teams/abstractions、teams/constraints、core/types | 豁免文件（\*.config.ts）；所有导入项均已在 facade 导出 |

---

#### 1.5 rag 模块（7 条）

| 文件                                         | 行       | 违规 import                                                                     | 修复建议                                                                       |
| -------------------------------------------- | -------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `rag/index.ts`                               | 26       | `from "../../ai-engine/rag"`                                                    | 将常用 RAG 类型加入 facade 导出，或保持 rag/index.ts 作为合法的 re-export 文件 |
| `rag/interfaces/rag.interfaces.ts`           | 22,28,36 | `from "../../../ai-engine/rag/pipeline/..."` / `rag/embedding` / `rag/chunking` | 已在 facade 导出 `EmbeddingResult`，其余类型需加入 facade                      |
| `rag/services/document-processor.service.ts` | 21       | `from "../../../ai-engine/rag"`                                                 | 从 facade 导入                                                                 |
| `rag/services/rag-pipeline.service.ts`       | 7        | `export { RAGPipelineService } from "../../../ai-engine/rag/pipeline"`          | 将 `RAGPipelineService` 加入 facade 导出                                       |

---

#### 1.6 research 模块（10 条）

| 文件                                                  | 行       | 违规 import                                                                                | 修复建议                                       |
| ----------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| `research/research.module.ts`                         | 13,14    | `AgentRegistry` from `agents/registry`；`TeamRegistry` from `teams/registry/team-registry` | 两者均已在 facade 导出，改用 facade 路径       |
| `research/project/research-project.module.ts`         | 17       | `TTS_SERVICE` from `tools/abstractions/generation-services.interface`                      | 将服务令牌加入 facade 导出                     |
| `research/discussion/iterative-search.service.ts`     | 3,4      | `ToolRegistry`、`ToolContext`                                                              | `ToolRegistry`、`ToolContext` 已在 facade 导出 |
| `research/project/research-project-source.service.ts` | 10,11    | 同上                                                                                       | 同上                                           |
| `research/agents/researcher.agent.ts`                 | 18,22,26 | `agents/base/plan-based-agent`、`core/types/agent.types`、`interfaces/research.interface`  | 豁免文件；需将研究接口加入 facade              |
| `research/teams/research-team.config.ts`              | 12-16    | 5 条 teams/abstractions、teams/constraints、core/types                                     | 豁免文件；均已在 facade 导出                   |

---

#### 1.7 simulation 模块（4 条）

| 文件                                   | 行       | 违规 import                                                                                 | 修复建议                                |
| -------------------------------------- | -------- | ------------------------------------------------------------------------------------------- | --------------------------------------- |
| `simulation/ai-simulation.module.ts`   | 11       | `AgentRegistry` from `agents/registry`                                                      | 已在 facade 导出，改用 facade 路径      |
| `simulation/agents/simulator.agent.ts` | 18,22,26 | `agents/base/plan-based-agent`、`core/types/agent.types`、`interfaces/simulation.interface` | 豁免文件；将 simulation 接口加入 facade |

---

#### 1.8 social 模块（3 条）

| 文件                                         | 行  | 违规 import                                                  | 修复建议                                   |
| -------------------------------------------- | --- | ------------------------------------------------------------ | ------------------------------------------ |
| `social/ai-social.module.ts`                 | 25  | `YOUTUBE_SERVICE_TOKEN` from `ai-engine/content-fetch`       | 将服务令牌加入 facade 导出                 |
| `social/core/mcp-client.service.ts`          | 21  | `from "@/modules/ai-engine/mcp/abstractions"`                | 将 MCP 抽象接口加入 facade 导出            |
| `social/services/content-fetcher.service.ts` | 5   | `sanitizeForDb, sanitizeJson` from `ai-engine/content-fetch` | 将工具函数加入 facade 导出，或提取到公共包 |

---

#### 1.9 teams 模块（38 条）

这是违规数量最多的子模块，存在大量对 orchestration/services、tools、teams 内部路径的直接访问。

| 文件                                                                     | 行          | 违规 import                                                                         | 修复建议                                                                        |
| ------------------------------------------------------------------------ | ----------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `teams/ai-teams.module.ts`                                               | 73,74       | `TeamRegistry` / `AgentRegistry` from 内部路径                                      | 均已在 facade 导出，改用 facade 路径                                            |
| `teams/agents/team-member.agent.ts`                                      | 10-15       | `core`、`tools/registry`、`tools/abstractions`                                      | 豁免文件；`BUILTIN_TOOLS`、`ToolRegistry`、`ToolContext` 已在 facade 导出       |
| `teams/agents/team-collaboration.agent.ts`                               | 20,24       | `agents/base/plan-based-agent`、`core/types/agent.types`                            | 豁免文件                                                                        |
| `teams/interfaces/mission-context.interface.ts`                          | 23          | `from "../../../ai-engine/teams/abstractions/mission-context.interface"`            | 将 `MissionContext` 相关类型加入 facade 导出                                    |
| `teams/services/ai/ai-response.service.ts`                               | 11,12,20,21 | `ToolRegistry`、`ToolContext`、`AgentEvent`、`BuiltinToolId`                        | `ToolRegistry`、`ToolContext`、`BUILTIN_TOOLS` 已在 facade；`AgentEvent` 需加入 |
| `teams/services/ai/context-compression.service.ts`                       | 19          | `from "../../../../ai-engine/orchestration/services"`                               | 通过 facade.xxx 访问                                                            |
| `teams/services/ai/context-router.service.ts`                            | 24,30       | 同上两条                                                                            | 同上                                                                            |
| `teams/services/ai/leader-model.service.ts`                              | 12,13       | `ai-engine/llm/model-fallback`、`ai-engine/llm`                                     | 将 `ModelFallbackOptions`、`AIModelConfig` 加入 facade 导出                     |
| `teams/services/ai/teams-long-content.service.ts`                        | 20          | `from "../../../../ai-engine/long-content"`                                         | 通过 facade.longContentEngine 访问                                              |
| `teams/services/collaboration/mission/mission-ai-caller.service.ts`      | 19          | `from "../../../../../ai-engine/llm/types/task-profile.types"`                            | `TaskProfile` 已在 facade 导出                                                  |
| `teams/services/collaboration/mission/mission-execution.service.ts`      | 23,25,26    | `TaskProfile`、`ToolRegistry`、`ToolContext`                                        | 均已在 facade 导出                                                              |
| `teams/services/collaboration/mission/mission-review.service.ts`         | 41          | `from "../../../../../ai-engine/orchestration/services"`                            | 通过 facade 访问                                                                |
| `teams/services/collaboration/mission/mission-state.manager.ts`          | 15          | `from "@/modules/ai-engine/orchestration/state-machine"`                            | 将 state-machine 类型加入 facade 导出                                           |
| `teams/services/collaboration/mission/task-breakdown.service.ts`         | 25          | `TeamMemberInfo` from `orchestration/services/interfaces`                           | 将 `TeamMemberInfo` 加入 facade 导出                                            |
| `teams/services/collaboration/mission/team-mission.service.ts`           | 20,21       | `ToolRegistry`、`ToolContext`                                                       | 均已在 facade 导出                                                              |
| `teams/services/collaboration/context/constraint-enforcement.service.ts` | 19          | `orchestration/services`                                                            | 通过 facade 访问                                                                |
| `teams/services/collaboration/context/token-budget.service.ts`           | 17          | `orchestration/services`                                                            | 通过 facade 访问                                                                |
| `teams/services/collaboration/utils/retry.utils.ts`                      | 26          | `orchestration/utils/error-detection.utils`                                         | 将工具函数加入 facade 导出                                                      |
| `teams/services/integration/ai-teams-integration.service.ts`             | 14-18       | `TeamRegistry`、`RoleRegistry`、`TeamConfig`、`ConstraintProfile`、`WorkflowConfig` | 所有 5 项均已在 facade 导出                                                     |
| `teams/teams/debate-team.config.ts`                                      | 12-16       | 5 条 teams/abstractions、teams/constraints、core/types                              | 豁免文件；均已在 facade 导出                                                    |

---

#### 1.10 topic-insights 模块（9 条）

| 文件                                                          | 行    | 违规 import                                           | 修复建议                                             |
| ------------------------------------------------------------- | ----- | ----------------------------------------------------- | ---------------------------------------------------- |
| `topic-insights/services/data/data-enrichment.service.ts`     | 18,19 | `ToolRegistry`、`ToolContext`                         | 均已在 facade 导出                                   |
| `topic-insights/services/data/data-source-fetcher.service.ts` | 2,7   | `ToolRegistry`、`tools/categories/information/policy` | `ToolRegistry` 已在 facade；policy 类型需加入 facade |
| `topic-insights/services/data/data-source-router.service.ts`  | 19,22 | 同上                                                  | 同上                                                 |
| `topic-insights/services/data/leader-tool.service.ts`         | 20    | `ToolRegistry`                                        | 已在 facade 导出                                     |
| `topic-insights/services/report/figure-extractor.service.ts`  | 2,3   | `ToolRegistry`、`ToolContext`                         | 均已在 facade 导出                                   |

---

#### 1.11 writing 模块（27 条）

| 文件                                                            | 行      | 违规 import                                                                                | 修复建议                                                                                      |
| --------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `writing/ai-writing.module.ts`                                  | 14      | `from "../../ai-engine/long-content/long-content.module"`                                  | 不应直接 import engine 子模块；通过 `AiEngineModule` 获取                                     |
| `writing/interfaces/writing-context.interface.ts`               | 17      | `from "../../../ai-engine/teams/abstractions/mission-context.interface"`                   | 将 `MissionContext` 相关类型加入 facade 导出                                                  |
| `writing/registry/writing-agent-registry.ts`                    | 19      | `from "../../../ai-engine/agents/abstractions/agent.interface"`                            | 将 agent 接口加入 facade 导出                                                                 |
| `writing/services/consistency/chapter-coherence.service.ts`     | 15      | `TaskProfile` from `ai-engine/llm/types`                                                   | `TaskProfile` 已在 facade 导出                                                                |
| `writing/services/mission/writing-agent-coordinator.service.ts` | 10-12   | `TeamRegistry`、`RoleRegistry`、`ITeam`                                                    | 均已在 facade 导出                                                                            |
| `writing/services/mission/writing-mission.service.ts`           | 35-45   | 6 条：teams、TeamRegistry、RoleRegistry、ConstraintProfile、long-content、GranularityLevel | 均已在 facade 导出；`GranularityLevel` 需加入 facade                                          |
| `writing/services/quality/expression-alternatives.service.ts`   | 16      | `TaskProfile`                                                                              | 已在 facade                                                                                   |
| `writing/services/quality/narrative-craft.service.ts`           | 26      | `TaskProfile`                                                                              | 已在 facade                                                                                   |
| `writing/services/quality/semantic-consistency.service.ts`      | 16      | `TaskProfile`                                                                              | 已在 facade                                                                                   |
| `writing/services/writing/chapter-writing.service.ts`           | 17      | `MissionEvent` from `teams/abstractions/mission.interface`                                 | `MissionEvent` 已在 facade 导出                                                               |
| `writing/agents/*.agent.ts`（4 个文件）                         | 各 4 条 | `agents/base/base-agent`、`agents/abstractions/agent.interface`、`core`、`llm/types`       | 豁免文件；`TaskProfile`、`BUILTIN_TOOLS` 已在 facade；需将 `BaseAgent`、agent 接口加入 facade |

---

### 关键发现：已在 facade 导出但仍走内部路径

以下符号已在 `facade/index.ts` 中导出，但 ai-app 代码仍直接访问内部路径。这属于**技术债**，修复零风险：

- `AgentRegistry` — 已在 facade 导出，但 `research.module.ts`、`simulation/ai-simulation.module.ts`、`teams/ai-teams.module.ts`、`image/ai-image.module.ts` 仍走 `ai-engine/agents/registry`
- `TeamRegistry` / `RoleRegistry` — 已在 facade 导出，但 `office.module.ts`、`planning.module.ts`、`teams/ai-teams.module.ts`、`writing/services/mission/writing-agent-coordinator.service.ts` 等仍走内部路径
- `SkillRegistry` — 已在 facade 导出，但 `slides-skills.module.ts` 仍走内部路径
- `ToolRegistry` / `ToolContext` / `ITool` — 已在 facade 导出，但大量 teams/topic-insights/research 文件仍走 `tools/registry/tool.registry` 直接路径
- `TaskProfile` — 已在 facade 导出，但 `writing/services/quality/` 下多个文件仍走 `llm/types`
- `TeamConfig`、`WorkflowConfig`、`BUILTIN_ROLES`、`BUILTIN_TOOLS`、`createConstraintProfile`、`MissionEvent` — 均已在 facade 导出，但 config 文件（豁免）仍走内部路径

---

## 第二章：反向依赖违规（规则 B）

**结论：无违规。**

扫描 `backend/src/modules/ai-engine/**/*.ts` 中所有包含 `ai-app` 的 import，结果为零。

仅发现两处注释说明（非 import）：

- `ai-engine/ai-engine.module.ts:55` — 注释说明 content-analysis 从 ai-app/office 迁移而来
- `ai-engine/content-analysis/content-analysis.prompts.ts:3` — 同为迁移注释

架构单向依赖方向 (ai-app → ai-engine) 得到严格遵守。

---

## 第三章：LLM 硬编码违规（规则 C）

### 3.1 ai-app 模块

**结论：ai-app 层无违规。**

扫描 `temperature:` 直接数值均为注释形式（如 `// 原 temperature: 0.7`），已正确迁移为 `taskProfile.creativity` 枚举值。扫描 `maxTokens:` 直接数值均为注释形式，已迁移为 `taskProfile.outputLength` 枚举值。

### 3.2 ai-engine 模块（3 条违规）

| 文件                                                             | 行      | 违规内容                                                     | 严重程度 | 修复建议                                                    |
| ---------------------------------------------------------------- | ------- | ------------------------------------------------------------ | -------- | ----------------------------------------------------------- |
| `ai-engine/llm/services/ai-chat.service.ts`                      | 271     | `temperature: 0`                                             | P1       | LLM 连接性测试用，可改为常量 `HEALTH_CHECK_TEMPERATURE = 0` |
| `ai-engine/orchestration/executors/function-calling-executor.ts` | 192,193 | `temperature: 0.7` / `maxTokens: 4096`                       | P1       | 提取为常量或使用 `DEFAULT_TASK_PROFILE`                     |
| `ai-engine/long-content/services/quality-monitor.service.ts`     | 263     | `actionParams: { temperature: 0.5, maxTokensIncrease: 500 }` | P2       | 提取为命名常量 `QUALITY_RETRY_PARAMS`                       |

> 注：`ai-engine/constraint/guardrails/cost-controller.ts` 中的 `model: "gpt-4o"` 等为定价参考表（pricing table），属于合理的硬编码，不计违规。

### 3.3 model 硬编码

在 ai-app 和 ai-engine 范围内未发现业务代码中的 model 硬编码。`cost-controller.ts` 的定价数据表和 `core/admin` 中的健康检查（属于 core 模块，不在审计范围）不计违规。

---

## 第四章：ESLint 覆盖缺口

### 4.1 当前覆盖情况

`backend/.eslintrc.js` 的 `no-restricted-imports` 规则覆盖了以下 ai-engine 路径：

| 覆盖路径                                               | 强制使用                          |
| ------------------------------------------------------ | --------------------------------- |
| `ai-engine/orchestration/services/intent-detection*`   | facade.intentDetector             |
| `ai-engine/orchestration/services/output-reviewer*`    | facade.outputReviewer             |
| `ai-engine/orchestration/services/context-evolution*`  | facade                            |
| `ai-engine/orchestration/services/circuit-breaker*`    | facade                            |
| `ai-engine/orchestration/services/agent-executor*`     | facade                            |
| `ai-engine/orchestration/services/task-planner*`       | facade                            |
| `ai-engine/orchestration/services/task-decomposer*`    | facade                            |
| `ai-engine/teams/orchestrator/mission-orchestrator*`   | facade.missionOrchestrator        |
| `ai-engine/teams/factory/team-factory*`                | facade.teamFactory                |
| `ai-engine/long-content/services/long-content-engine*` | facade.longContentEngine          |
| `ai-engine/capabilities/**`                            | facade.capabilityResolverService  |
| `ai-engine/realtime/**`                                | facade.emitToRoom/emitProgress    |
| `ai-engine/memory/stores/**`                           | facade.storeMemory/retrieveMemory |
| `ai-engine/content-fetch/content-fetch.service*`       | facade.contentFetch               |

### 4.2 未覆盖目录（18 个）

以下 ai-engine 子目录完全没有 ESLint 守护，ai-app 代码可自由直接访问：

| 未覆盖目录                                                                                                                                    | 当前实际被直接访问                                                                      | 风险等级     |
| --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------ |
| `ai-engine/agents/` (base, registry, abstractions)                                                                                            | 是（9 处 base、6 处 abstractions、4 处 registry）                                       | 高           |
| `ai-engine/tools/` (registry, abstractions, categories)                                                                                       | 是（11 处 registry、9 处 abstractions、2 处 categories）                                | 高           |
| `ai-engine/llm/` (types, adapters, model-fallback)                                                                                            | 是（11 处）                                                                             | 高           |
| `ai-engine/skills/` (registry, runtime, abstractions)                                                                                         | 是（9 处 abstractions、2 处 registry、1 处 runtime）                                    | 高           |
| `ai-engine/teams/abstractions/`                                                                                                               | 是（8 处 team.interface、7 处 workflow、6 处 role、3 处 mission-context、2 处 mission） | 高           |
| `ai-engine/teams/constraints/`                                                                                                                | 是（7 处）                                                                              | 高           |
| `ai-engine/teams/registry/`                                                                                                                   | 是（10 处 team-registry、多处 role-registry）                                           | 中           |
| `ai-engine/orchestration/executors`                                                                                                           | 是（1 处 AgentEvent）                                                                   | 中           |
| `ai-engine/orchestration/state-machine`                                                                                                       | 是（1 处）                                                                              | 中           |
| `ai-engine/orchestration/utils`                                                                                                               | 是（1 处 error-detection.utils）                                                        | 中           |
| `ai-engine/rag/` (所有子目录)                                                                                                                 | 是（3 处）                                                                              | 中           |
| `ai-engine/long-content/` (除 long-content-engine)                                                                                            | 是（2 处 interfaces、1 处索引）                                                         | 中           |
| `ai-engine/core/`                                                                                                                             | 是（10 处 core/types/agent.types）                                                      | 中           |
| `ai-engine/interfaces/`                                                                                                                       | 是（2 处 image.interface、1 处 simulation）                                             | 低           |
| `ai-engine/mcp/abstractions`                                                                                                                  | 是（1 处）                                                                              | 低           |
| `ai-engine/image/matching`                                                                                                                    | 是（3 处）                                                                              | 低           |
| `ai-engine/content-analysis/`                                                                                                                 | 是（2 处类型）                                                                          | 低           |
| `ai-engine/synthesis/`、`ai-engine/search/`、`ai-engine/quality/`、`ai-engine/collaboration/`、`ai-engine/guardrails/`、`ai-engine/evidence/` | 未被访问（目前）                                                                        | 低（预防性） |

### 4.3 ESLint excludedFiles 豁免评估

当前豁免了 4 类文件：

- `**/agents/*.agent.ts` — 合理（必须继承 BaseAgent/PlanBasedAgent）
- `**/*.config.ts` — **过宽**：config 文件可以导入 TeamConfig、BUILTIN_ROLES 等已在 facade 的类型，但豁免使其可绕过 facade
- `**/skills/*.skill.ts` — 合理（必须实现 Skill 接口）
- `**/common/*.service.ts` — **过宽**：`office/common` 的 re-export 文件可以保留豁免，但其他 common 目录中普通 service 也被豁免

---

## 第五章：注册模式合规情况（规则 D）

### 5.1 有 Agent/Team 的模块（检查 onModuleInit + registry.register）

| 模块                                      | onModuleInit | 注册内容                                                                                             | 状态 |
| ----------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------- | ---- |
| `image/ai-image.module.ts`                | 是           | `AgentRegistry.register(imageDesignerAgent)`                                                         | 合规 |
| `office/ai-office.module.ts`              | 是           | `teamRegistry.registerConfig(x3)`                                                                    | 合规 |
| `planning/ai-planning.module.ts`          | 是           | `teamRegistry.registerConfig(PLANNING_TEAM_CONFIG)`                                                  | 合规 |
| `research/research.module.ts`             | 是           | `agentRegistry.register(researcherAgent)` + `teamRegistry.registerConfig(RESEARCH_TEAM_CONFIG)`      | 合规 |
| `simulation/ai-simulation.module.ts`      | 是           | `agentRegistry.register(simulatorAgent)`                                                             | 合规 |
| `teams/ai-teams.module.ts`                | 是           | `teamRegistry.registerConfig(DEBATE_TEAM_CONFIG)` + `agentRegistry.register(teamCollaborationAgent)` | 合规 |
| `topic-insights/topic-insights.module.ts` | 是           | `promptSkillBridge.registerDomain("research")` + connectorRegistry.register(x4)                      | 合规 |
| `writing/ai-writing.module.ts`            | 是           | `promptSkillBridge.registerDomain("writing")`                                                        | 合规 |

### 5.2 无 Agent/Team 的模块（不需要注册）

| 模块                         | 说明                                 |
| ---------------------------- | ------------------------------------ |
| `ask/ai-ask.module.ts`       | 无自定义 Agent，仅调用 LLM，无需注册 |
| `rag/rag.module.ts`          | RAG 管道，无 Agent，无需注册         |
| `social/ai-social.module.ts` | 无自定义 Agent，无需注册             |

### 5.3 特殊情况

- `writing/ai-writing.module.ts` 注释中说明 writing agents 不需要注册到全局 AgentRegistry（独立管理），设计合理但需文档说明
- `teams/ai-teams.module.ts` 的 `AgentRegistry` / `TeamRegistry` import 路径违反规则 A（走内部路径），但注册行为本身正确

---

## 第六章：代码规范问题（规则 E）

### 6.1 console.log

| 文件                                    | 行      | 内容               | 评估                                                                     |
| --------------------------------------- | ------- | ------------------ | ------------------------------------------------------------------------ |
| `ai-app/social/utils/session-crypto.ts` | 201-207 | 5 条 `console.log` | **违规**：注释说明"CLI utility"，但此文件在 NestJS 应用中，应使用 Logger |

ai-engine 中发现的 `console.log` 均在 JSDoc 注释示例代码（`facade/ai-engine.facade.ts`）和 example 文件中（`tools/.../document-processor.example.ts`），不计实际违规。

### 6.2 any 类型

**ai-app 模块**：112 处 `any` 使用（非 spec 文件）

高频文件（top 10）：

| 文件                                                            | any 使用数 |
| --------------------------------------------------------------- | ---------- |
| `image/generation/image-generation.service.ts`                  | 5          |
| `research/agents/researcher.agent.ts`                           | 4          |
| `writing/services/consistency/post-write-validation.service.ts` | 3          |
| `writing/services/consistency/fact-extractor.service.ts`        | 3          |
| `topic-insights/services/core/topic-crud.service.ts`            | 3          |
| `topic-insights/services/core/research-memory.service.ts`       | 3          |
| `research/project/research-project-chat.service.ts`             | 3          |
| `image/generation/prompt-enhancement.service.ts`                | 3          |
| `writing/services/parallel/chapter-dependency.service.ts`       | 2          |
| `writing/services/mission/writing-persistence.service.ts`       | 2          |

**ai-engine 模块**：40 处 `any` 使用（非 spec 文件）

### 6.3 硬编码品牌名

| 文件                                                | 行  | 内容                                                | 评估                                                             |
| --------------------------------------------------- | --- | --------------------------------------------------- | ---------------------------------------------------------------- |
| `office/slides/skills/content-compression.skill.ts` | 141 | `"footer": "2024年度分析报告 \| DeepDive Research"` | **违规**：示例数据中硬编码品牌名，应使用 `APP_CONFIG.brand.name` |
| `ask/constants/project-context.ts`                  | 2   | 文件头注释 "GenesisPod 项目上下文"                  | 注释，非字符串字面量，不计违规                                   |

---

## 优先级矩阵

### P0 — 立即修复（本次 Sprint 内）

> 直接破坏架构规则，影响可维护性和边界清晰度

| #    | 问题                                                                                                                                                                                                                                 | 影响范围           | 建议操作                                        |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------ | ----------------------------------------------- |
| P0-1 | **已在 facade 导出却仍走内部路径**（~40 条违规）：AgentRegistry、TeamRegistry、RoleRegistry、SkillRegistry、ToolRegistry/ToolContext、TaskProfile、TeamConfig、BUILTIN_ROLES/BUILTIN_TOOLS、createConstraintProfile、MissionEvent 等 | 全部 ai-app 子模块 | 批量 import 替换，将路径改为 `ai-engine/facade` |
| P0-2 | **module.ts 文件走内部路径注入 Registry**：research.module.ts、simulation module、teams module、image module、office module、planning module 均在 module 文件中直接 import registry 内部路径                                         | 6 个模块文件       | 替换为 facade 路径，零功能风险                  |

### P1 — 本迭代（本 Sprint 内完成，不阻塞发布）

| #    | 问题                                                                                                                                                                                                                                                                    | 影响范围                        | 建议操作                                                                                                                                                                                                                              |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1-1 | **ESLint 覆盖缺口：agents、tools、llm、skills、teams/abstractions/constraints 未加守护**                                                                                                                                                                                | 所有 ai-app                     | 在 `.eslintrc.js` 增加 `ai-engine/agents/**`、`ai-engine/tools/**`、`ai-engine/llm/**`、`ai-engine/skills/**`、`ai-engine/teams/abstractions/**`、`ai-engine/teams/constraints/**`、`ai-engine/core/**` 的 no-restricted-imports 规则 |
| P1-2 | **facade 缺少必要导出**（导致合法需求无法满足）：`AgentEvent`、`IAgent` 接口、`MissionContext`、`ToolContext`、`SkillContext`、`GranularityLevel`、`ModelFallbackOptions`、`AIModelConfig`、`TeamMemberInfo`、`RAGPipelineService`、`image-matching` 类型等约 15 个符号 | teams、writing、office、rag     | 将这些符号加入 `facade/index.ts`                                                                                                                                                                                                      |
| P1-3 | **ai-engine 内部 LLM 硬编码**：function-calling-executor.ts `temperature: 0.7` / `maxTokens: 4096`                                                                                                                                                                      | ai-engine orchestration         | 提取为命名常量                                                                                                                                                                                                                        |
| P1-4 | **any 类型清理**（高频文件）：image-generation.service.ts、researcher.agent.ts、topic-crud.service.ts                                                                                                                                                                   | image、research、topic-insights | 补充具体接口类型                                                                                                                                                                                                                      |

### P2 — 下次迭代

| #    | 问题                                                                                                                                                            | 影响范围       | 建议操作                                                                              |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------- |
| P2-1 | **teams 模块大量服务层直接访问 orchestration/services 内部**（context-router、context-compression、mission-review、token-budget、constraint-enforcement）       | ai-app/teams   | 通过 facade.circuitBreaker / facade.contextRouter 等访问，或在 facade 补充相应 getter |
| P2-2 | **writing 模块直接 import long-content 子模块**（ai-writing.module.ts 直接 import LongContentModule，writing-mission.service.ts 直接 import long-content 导出） | ai-app/writing | writing.module.ts 改为使用 AiEngineModule；服务层改为使用 facade.longContentEngine    |
| P2-3 | **rag 模块完整重构**：rag/index.ts 和 interfaces/rag.interfaces.ts 大量直接访问 ai-engine/rag 内部                                                              | ai-app/rag     | 将 RAG 相关类型和服务统一从 facade 导出，清理 re-export 链                            |
| P2-4 | **social/core/mcp-client.service.ts** 直接访问 ai-engine/mcp/abstractions                                                                                       | social         | 将 MCP 抽象接口加入 facade 导出                                                       |
| P2-5 | **ESLint excludedFiles 收紧**：`*.config.ts` 豁免过宽，应仅允许访问已在 facade 的符号                                                                           | eslint 配置    | 细化豁免规则，或为 config 文件单独维护允许列表                                        |
| P2-6 | **any 类型系统性清理**（剩余 ~100 处）                                                                                                                          | 全模块         | 逐文件替换为具体类型                                                                  |

### P3 — 长期技术债

| #    | 问题                                                                                                                               | 影响范围 | 建议操作                                             |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------- |
| P3-1 | `office/slides/skills/*.skill.ts`（9 个文件）直接访问 skill 接口——属于 ESLint 豁免文件，但理想状态下也应通过 facade 导入接口类型   | office   | 当 facade 完成 skills 相关类型导出后，移除豁免       |
| P3-2 | `content-compression.skill.ts` 示例数据中 "DeepDive Research" 硬编码                                                               | office   | 替换为占位符或 `APP_CONFIG.brand.name`               |
| P3-3 | `social/utils/session-crypto.ts` console.log                                                                                       | social   | 替换为 Logger 或移为独立 CLI 脚本                    |
| P3-4 | 为 ai-engine/synthesis、search、quality、collaboration、guardrails、evidence 预防性增加 ESLint 守护                                | eslint   | 预防未来违规                                         |
| P3-5 | writing agents（bible-keeper、consistency-checker、editor、story-architect、writer）4 个文件各 4 条内部 import——豁免文件，但可改善 | writing  | 当 facade 完成 BaseAgent、agent interface 导出后迁移 |

---

## 行动项清单

### 本次 Sprint（P0 + P1）

- [ ] **P0-1** 批量替换已在 facade 导出的符号的 import 路径（约 40 处，5 个文件类别）
- [ ] **P0-2** 修复 6 个 module.ts 文件中的 Registry import 路径（research、simulation、teams、image、office、planning）
- [ ] **P1-1** 更新 `.eslintrc.js`：补充 agents、tools、llm、skills、teams/abstractions、teams/constraints、core 的 no-restricted-imports 规则
- [ ] **P1-2** 更新 `facade/index.ts`：补充 ~15 个缺失导出（AgentEvent、IAgent 接口、MissionContext、ToolContext、SkillContext、GranularityLevel、ModelFallbackOptions、AIModelConfig、TeamMemberInfo、RAGPipelineService 等）
- [ ] **P1-3** 修复 `function-calling-executor.ts` 中硬编码的 temperature/maxTokens

### 下次 Sprint（P2）

- [ ] **P2-1** teams 服务层 orchestration 访问路由到 facade
- [ ] **P2-2** writing 模块 long-content 访问重构
- [ ] **P2-3** rag 模块接口/re-export 清理
- [ ] **P2-4** social mcp 抽象接口加入 facade
- [ ] **P2-5** ESLint excludedFiles \*.config.ts 豁免收紧
- [ ] **P2-6** any 类型高频文件专项清理

### 长期积压（P3）

- [ ] **P3-1** skills 接口类型加入 facade 后移除 \*.skill.ts 豁免
- [ ] **P3-2** content-compression.skill.ts 品牌名修复
- [ ] **P3-3** session-crypto.ts console.log 修复
- [ ] **P3-4** 预防性 ESLint 守护扩展

---

## 附录：Facade 合法导出清单（审计基准）

以下符号已在 `backend/src/modules/ai-engine/facade/index.ts` 中导出，ai-app 导入这些符号时**必须**使用 facade 路径：

```
AIEngineFacade, RoomConfig, EngineEvent, SaveEvidenceRequest,
AICapabilityContext, SkillPromptBundle, SkillPromptOptions,
SkillMdDefinition, EmbeddingResult, SimilaritySearchOptions,
SimilarityResult, TaskCompletionType, UserIntent, TeamInfo,
ToolRegistry, AgentRegistry, TeamRegistry, RoleRegistry, SkillRegistry,
TaskProfile, TeamConfig, ITeam, WorkflowConfig, ConstraintProfile,
BUILTIN_ROLES, BUILTIN_TOOLS, createConstraintProfile, MissionEvent,
ToolContext, ITool, PromptSkillBridge
```


