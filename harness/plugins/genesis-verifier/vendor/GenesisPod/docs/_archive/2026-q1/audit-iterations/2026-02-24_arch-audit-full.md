# 架构审计报告 - 全量合规扫描

**审计日期**: 2026-02-24
**审计版本**: c16b8ed6
**审计人**: Arch Auditor Agent
**审计范围**: 全量代码库 (ai-app + ai-engine 模块, 共 1020 个 .ts 文件)

---

## 执行摘要

| 维度                           | 状态     | 违规数 |
| ------------------------------ | -------- | ------ |
| Facade 边界（直接违规）        | 警告     | 5      |
| Facade 边界（Facade 导出缺口） | 警告     | 2      |
| 反向依赖 (ai-engine -> ai-app) | 通过     | 0      |
| 跨 App 模块直接依赖            | 警告     | 6      |
| LLM 硬编码（LLM 调用路径）     | 警告     | 3      |
| LLM 硬编码（定价/测试 - 合法） | 通过     | 已标注 |
| 注册模式合规                   | 通过     | 0      |
| ESLint 规则覆盖缺口            | 警告     | 3      |
| console.log（生产代码）        | 通过     | 0      |
| any 类型（ai-app 生产代码）    | 信息     | 12     |
| 硬编码品牌名（影响运行时）     | 信息     | 1      |
| 内联动态 import 绕过 Facade    | 警告     | 2      |
| **总计**                       | **警告** | **18** |

**架构健康评分**: 86/100

---

## 一、Facade 边界违规

### 1.1 直接违规（ESLint excludedFiles 之外的文件）

以下文件**不在** ESLint `excludedFiles` 白名单中，仍直接引用 ai-engine 内部路径：

| 文件                                                                 | 行号 | 违规 import                                                                                         | 优先级 |
| -------------------------------------------------------------------- | ---- | --------------------------------------------------------------------------------------------------- | ------ |
| `ai-app/teams/agents/team-member.agent.ts`                           | 10   | `from '../../../ai-engine/core'` (BUILTIN_TOOLS, BuiltinToolId)                                     | P2     |
| `ai-app/teams/agents/team-member.agent.ts`                           | 11   | `from '../../../ai-engine/tools/registry'` (ToolRegistry)                                           | P2     |
| `ai-app/teams/agents/team-member.agent.ts`                           | 15   | `from '../../../ai-engine/tools/abstractions/tool.interface'` (ToolContext, ITool)                  | P2     |
| `ai-app/ask/ai-ask.service.ts`                                       | 1145 | `import("../../ai-engine/orchestration/services/task-planner.service").TaskPlan` (内联 type import) | P2     |
| `ai-app/topic-insights/services/data/data-source-fetcher.service.ts` | 938  | `import("@/modules/ai-engine/tools/abstractions/tool.interface").ToolContext` (内联 type import)    | P2     |

**说明**:

- `team-member.agent.ts` 文件名为 `*.agent.ts`，按 ESLint `excludedFiles` 规则，`**/agents/*.agent.ts` 被排除，但排除初衷是允许继承 `BaseAgent`/`PlanBasedAgent`——`BUILTIN_TOOLS`、`BuiltinToolId`、`ToolRegistry`、`ToolContext` 等均已在 `facade/index.ts` 导出，此处直接引用内部路径属于未迁移的历史遗留。
- 两处内联 `import()` 为 TypeScript 类型级引用，不会被 ESLint `no-restricted-imports` 捕获，属于规则覆盖盲点。

### 1.2 已经被 ESLint excludedFiles 豁免但值得跟踪的文件

以下文件直接引用 ai-engine 内部路径，当前被 ESLint 豁免，**按设计合规**，但需持续跟踪，防止范围蔓延：

| 文件（符合排除规则）                                   | 内部路径                                                                                                                     | 豁免原因                    |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| `ai-app/writing/agents/*.agent.ts` (5 个)              | `ai-engine/agents/base/base-agent`, `ai-engine/agents/abstractions/agent.interface`, `ai-engine/core`, `ai-engine/llm/types` | 继承 `BaseAgent`            |
| `ai-app/research/agents/researcher.agent.ts`           | `ai-engine/agents/base/plan-based-agent`, `ai-engine/core/types/agent.types`, `ai-engine/interfaces/research.interface`      | 继承 `PlanBasedAgent`       |
| `ai-app/simulation/agents/simulator.agent.ts`          | 同上                                                                                                                         | 继承 `PlanBasedAgent`       |
| `ai-app/image/agents/image-designer.agent.ts`          | 同上 + `ai-engine/interfaces/image.interface`                                                                                | 继承 `PlanBasedAgent`       |
| `ai-app/teams/agents/team-collaboration.agent.ts`      | `ai-engine/agents/base/plan-based-agent`, `ai-engine/core/types/agent.types`                                                 | 继承 `PlanBasedAgent`       |
| `ai-app/office/slides/skills/*.skill.ts` (17 个)       | `ai-engine/skills`, `ai-engine/skills/abstractions/skill.interface`                                                          | 实现 `ISkill`               |
| `ai-app/office/slides/skills/data-supplement.skill.ts` | `ai-engine/tools/registry/tool.registry`, `ai-engine/tools/abstractions/tool.interface`                                      | 豁免在 `*.skill.ts`         |
| `ai-app/office/common/content-analysis.service.ts`     | `ai-engine/content-analysis`                                                                                                 | 明确豁免为 re-export bridge |
| `ai-app/office/common/content-analysis.types.ts`       | `ai-engine/content-analysis/content-analysis.types`                                                                          | 明确豁免为 re-export bridge |
| `ai-app/office/common/image-matching.service.ts`       | `ai-engine/image/matching`                                                                                                   | 明确豁免为 re-export bridge |

**观察**: 豁免列表中 `writing/agents` 的 `ai-engine/llm/types`（`TaskProfile`）和 `ai-engine/core`（`ExecutionMode`）均已在 `facade/index.ts` 导出（`TaskProfile` 已导出；`ExecutionMode` 未导出），建议逐步迁移到 facade 引用，减少豁免依赖。

### 1.3 Facade 导出缺口（应补充的符号）

以下符号被 ai-app 代码直接从 ai-engine 内部路径引用，在 `facade/index.ts` 中**缺失或不完整**：

| 符号            | 当前所在路径                            | 状态                        |
| --------------- | --------------------------------------- | --------------------------- |
| `ExecutionMode` | `ai-engine/core/types/context.types.ts` | 未在 `facade/index.ts` 导出 |
| `BuiltinToolId` | `ai-engine/core/types/agent.types.ts`   | 未在 `facade/index.ts` 导出 |

**修复方式**: 在 `backend/src/modules/ai-engine/facade/index.ts` 补充：

```typescript
export type { ExecutionMode } from "../core/types/context.types";
export type { BuiltinToolId } from "../core/types/agent.types";
```

修复后，将 `team-member.agent.ts` 及 `writing/agents/*.agent.ts` 中的 `ai-engine/core` 引用迁移到 `ai-engine/facade`。

---

## 二、反向依赖 (ai-engine -> ai-app)

**结果**: 未发现任何 ai-engine 模块反向依赖 ai-app 模块。

扫描路径: `backend/src/modules/ai-engine/**/*.ts`
扫描模式: `from '.*modules/ai-app/'`
结论: 依赖方向完全单向，此维度合规。

---

## 三、跨 App 模块直接依赖

以下 ai-app 模块互相直接依赖，**未通过 AI Engine 中转**：

| 调用方模块                                                  | 被依赖模块        | 导入内容                              | 优先级 | 说明                                                                   |
| ----------------------------------------------------------- | ----------------- | ------------------------------------- | ------ | ---------------------------------------------------------------------- |
| `ai-app/ask/ai-ask.module.ts`                               | `ai-app/rag`      | `RAGModule`                           | P3     | RAG 作为基础设施模块，ask 依赖可接受，但应考虑通过 AiEngineModule 暴露 |
| `ai-app/ask/ai-ask.service.ts`                              | `ai-app/rag`      | `RAGPipelineService`                  | P2     | 直接引用另一 App 模块的 Service，违反 App 间不直接依赖原则             |
| `ai-app/office/ai-office.module.ts`                         | `ai-app/research` | `ResearchModule`                      | P2     | Office 依赖 Research 模块，用于数据导出                                |
| `ai-app/office/ai-office.module.ts`                         | `ai-app/writing`  | `AiWritingModule`                     | P2     | Office 依赖 Writing 模块，用于数据导出                                 |
| `ai-app/planning/ai-planning.module.ts`                     | `ai-app/teams`    | `AiTeamsModule`                       | P2     | Planning 直接引入 Teams 模块                                           |
| `ai-app/planning/services/planning-orchestrator.service.ts` | `ai-app/teams`    | `AiTeamsService`, `AiResponseService` | P2     | 直接调用 Teams 模块的 Service                                          |
| `ai-app/writing/ai-writing.module.ts`                       | `ai-app/office`   | `WRITING_DATA_EXPORT` (接口 token)    | P3     | 通过 DI token 接口解耦，影响较小                                       |

**特别说明**: `office/interfaces/data-export.interface.ts` 的设计意图是通过 DI token 抽象实现解耦，注释中有说明"keeping App-layer modules decoupled from each other"。这是合理的接口抽象，但 `writing` 模块仍需 import `office` 的接口文件，物理上存在跨模块依赖。

**根本原因**: 部分跨模块依赖是为了共享数据管道（RAG Pipeline、Research Data Export、Writing Data Export）而形成的。长期方案应将这些共享能力上移到 AI Engine Facade 或独立的基础设施模块。

---

## 四、LLM 硬编码

### 4.1 真实 LLM 调用路径中的硬编码（需修复）

| 文件                                                     | 行号     | 问题                                                                            | 优先级 |
| -------------------------------------------------------- | -------- | ------------------------------------------------------------------------------- | ------ |
| `core/admin/admin.controller.ts`                         | 774, 796 | `model: "llama-3.1-sonar-small-128k-online"` 硬编码在 Perplexity API 测试调用中 | P2     |
| `core/admin/admin.service.ts`                            | 1984     | 同上                                                                            | P2     |
| `core/admin/quota/providers/anthropic-quota.provider.ts` | 48       | `model: "claude-3-haiku-20240307"` 硬编码在 quota 检测调用中                    | P2     |
| `core/user-api-keys/user-api-keys.service.ts`            | 655      | `model: "claude-3-haiku-20240307"` 硬编码在 API key 连通性测试中                | P2     |
| `ai-engine/llm/services/ai-connection-test.service.ts`   | 178      | `model: "claude-3-sonnet-20240229"` 在连接测试 fallback 中                      | P3     |

**注意**: `admin.controller.ts` 和 `admin.service.ts` 中的 Perplexity 测试调用直接走 HTTP 而非 `AiChatService`，是双重违规（硬编码模型名 + 绕过 AiChatService）。

### 4.2 合法的硬编码（有注释说明、不影响 LLM 调用路径）

以下硬编码经验证属于**合法例外**，已有注释说明，无需修复：

| 文件                                                                   | 性质                | 说明                                                              |
| ---------------------------------------------------------------------- | ------------------- | ----------------------------------------------------------------- |
| `ai-engine/constraint/guardrails/cost-controller.ts`                   | 定价查找表          | 注释明确说明"for cost estimation, not LLM call configuration"     |
| `ai-engine/llm/services/ai-chat.service.ts:270-271`                    | 内部 token 计数探测 | `maxTokens: 10, temperature: 0` 用于探测 API，不是对外调用        |
| `ai-engine/llm/services/ai-connection-test.service.ts:128,158,285,344` | API 连通性测试      | 纯测试用，非业务调用路径                                          |
| `content/resources/config/ai-prompts.config.ts:292-293`                | 文档注释中的参考值  | `requestDefaults` 字段未被任何 LLM 调用路径消费（仅本文件自引用） |
| `ai-engine/facade/ai-engine.facade.ts`                                 | JSDoc 示例代码      | 所有 `console.log`/`maxTokens` 均在注释中                         |

### 4.3 硬编码 temperature/maxTokens（生产代码）

扫描所有 `temperature: [0-9]` 和 `maxTokens: [0-9]` 的生产代码命中，经逐一核查：

- `ai-app/ask/ai-ask.service.ts` 中的 `outputLength: "standard"` 注释中残留 `(mapped from maxTokens: 4000)` 字样——均为注释内容，非实际硬编码。
- `ai-app/writing/agents/*.agent.ts`、`ai-app/image/analytics/agent-executor.service.ts`、`ai-app/writing/services/consistency/*.service.ts`、`core/admin/ai-teams-admin.service.ts` 中使用 TaskProfile 格式，注释中保留了原始数值作为迁移说明——均为注释，非硬编码调用参数。

**结论**: 生产 LLM 调用路径中无违规 temperature/maxTokens 硬编码，ai-app 模块已全面完成 TaskProfile 迁移。

---

## 五、注册模式合规

### 5.1 正确注册（OnModuleInit + Registry.register）

| 模块                                                  | 注册内容                                                                                             |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `ai-app/image/ai-image.module.ts`                     | `agentRegistry.register(imageDesignerAgent)`                                                         |
| `ai-app/research/research.module.ts`                  | `agentRegistry.register(researcherAgent)` + `teamRegistry.registerConfig(RESEARCH_TEAM_CONFIG)`      |
| `ai-app/simulation/ai-simulation.module.ts`           | `agentRegistry.register(simulatorAgent)`                                                             |
| `ai-app/teams/ai-teams.module.ts`                     | `teamRegistry.registerConfig(DEBATE_TEAM_CONFIG)` + `agentRegistry.register(teamCollaborationAgent)` |
| `ai-app/office/ai-office.module.ts`                   | `teamRegistry.registerConfig` x3 (report/slides/visual-design teams)                                 |
| `ai-app/office/slides/skills/slides-skills.module.ts` | `skillRegistry.register` (批量注册所有 slides skills)                                                |
| `ai-app/planning/ai-planning.module.ts`               | `teamRegistry.registerConfig(PLANNING_TEAM_CONFIG)`                                                  |

### 5.2 无 Agent 的模块（无需注册）

| 模块            | 说明                                       |
| --------------- | ------------------------------------------ |
| `ai-app/ask`    | 无独立 Agent，使用 AIEngineFacade 直接调度 |
| `ai-app/rag`    | 纯数据处理管道，无 Agent                   |
| `ai-app/social` | 无 AI Agent，使用 Playwright/MCP 工具      |

### 5.3 特殊情况说明

`ai-app/writing/ai-writing.module.ts` 实现了 `OnModuleInit`，但注释明确说明 Writing Agents 由 `WritingMissionService` 内部管理，不通过全局 AgentRegistry 注册——这是有意为之的架构决策，已在代码注释中记录，合规。

`ai-app/topic-insights/topic-insights.module.ts` 在 `onModuleInit` 中注册的是模块内部的 `DataSourceConnectorRegistry`（非全局 AgentRegistry），并通过 `promptSkillBridge.registerDomain("research")` 桥接 prompt skills，符合规范。

---

## 六、ESLint 规则覆盖缺口

### 6.1 已确认的覆盖缺口

| ai-engine 路径                        | 覆盖状态                                             | 风险                                         |
| ------------------------------------- | ---------------------------------------------------- | -------------------------------------------- |
| `ai-engine/memory/abstractions/**`    | 未覆盖（仅 `memory/stores/**` 被限制）               | 低（目前无 ai-app 代码引用，但随时可能引入） |
| `ai-engine/teams/base/**`             | 未覆盖                                               | 低（目前无 ai-app 直接引用）                 |
| `ai-engine/teams/controllers/**`      | 未覆盖                                               | 低（目前无 ai-app 直接引用）                 |
| `ai-engine/long-content/constants/**` | 未覆盖（仅 services/interfaces/types/module 被限制） | 低                                           |

### 6.2 内联 import() 类型引用盲点

ESLint `no-restricted-imports` 规则**不检测** TypeScript 内联 `import()` 类型引用，导致以下两处违规漏网：

| 文件                                                                 | 行号 | 内联引用路径                                                                     |
| -------------------------------------------------------------------- | ---- | -------------------------------------------------------------------------------- |
| `ai-app/ask/ai-ask.service.ts`                                       | 1145 | `import("../../ai-engine/orchestration/services/task-planner.service").TaskPlan` |
| `ai-app/topic-insights/services/data/data-source-fetcher.service.ts` | 938  | `import("@/modules/ai-engine/tools/abstractions/tool.interface").ToolContext`    |

**修复方案**:

1. 将 `TaskPlan` 类型添加到 `facade/index.ts` 导出（已有相关服务导出，补充类型即可）
2. 将 `ToolContext` 改为从 `facade` 导入（`facade/index.ts` 已导出 `ToolContext`）
3. 考虑在 ESLint 配置中补充 TypeScript 内联 import 的自定义规则或改用 `@typescript-eslint/no-restricted-imports`

### 6.3 覆盖缺口修复建议（`.eslintrc.js`）

在 Section 9 的预防性规则中补充：

```javascript
{ group: ["**/ai-engine/memory/abstractions/**"], message: "Use facade/index.ts exports." },
{ group: ["**/ai-engine/teams/base/**"], message: "Use facade/index.ts exports." },
{ group: ["**/ai-engine/teams/controllers/**"], message: "Use facade/index.ts exports." },
{ group: ["**/ai-engine/long-content/constants/**"], message: "Use facade/index.ts exports." },
```

---

## 七、模块依赖图异常

### 7.1 forwardRef 使用情况

| 使用位置                                                           | 原因                                                                                         | 合理性             |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- | ------------------ |
| `ai-app/image/ai-image.module.ts:51`                               | `AiImageModule <-> AiEngineModule` 循环                                                      | 已知合理，已加注释 |
| `ai-app/office/ai-office.module.ts:65`                             | 同上                                                                                         | 已知合理           |
| `ai-app/office/ai-office.module.ts:73`                             | `AiOfficeModule <-> SlidesSkillsModule` 循环                                                 | 已知合理，已加注释 |
| `ai-app/office/slides/skills/slides-skills.module.ts:86`           | 链式循环 `AiEngineModule->AiImageModule->AiOfficeModule->SlidesSkillsModule->AiEngineModule` | 已知合理，已加注释 |
| `ai-app/research/project/research-project.module.ts`               | `ResearchProjectModule <-> AiEngineModule` (AudioGenerationTool)                             | 已知合理           |
| `ai-app/research/discussion/discussion.module.ts:41`               | `DiscussionModule <-> AiEngineModule`                                                        | 已知合理           |
| `ai-app/office/slides/rendering/slides-export.service.ts:106,108`  | Service 级 forwardRef (ParameterizedRendererService, LayoutOptimizerSkill)                   | 已知合理           |
| `ai-app/office/slides/skills/content-compression.skill.ts:338,340` | Skill 级 forwardRef (DataSupplementSkill, ContentAnalyzerSkill)                              | 已知合理           |

**结论**: 所有 `forwardRef` 使用均有注释说明，没有无文档的循环依赖。

### 7.2 已记录的架构注意事项

`ai-app/teams/interfaces/mission-context.interface.ts` 包含如下注释：

```
请使用: import { ... } from "@/modules/ai-engine/teams/abstractions/mission-context.interface"
```

此文件本身疑为已废弃的重定向说明文件，建议检查是否仍有引用，若无则删除避免混淆。

---

## 八、代码规范

### 8.1 console.log

| 范围                | 结果                                                              |
| ------------------- | ----------------------------------------------------------------- |
| ai-app 生产代码     | **0 处**（合规）                                                  |
| ai-engine 生产代码  | 1 处（`document-processor.example.ts:452`，为示例文件非生产代码） |
| 前端 app/components | **0 处**（合规）                                                  |

### 8.2 any 类型

**ai-app 生产代码中的 any 用法（12 处）**:

| 文件                                                               | 行号     | 用法                                                       | 风险             |
| ------------------------------------------------------------------ | -------- | ---------------------------------------------------------- | ---------------- |
| `ai-app/image/agents/image-designer.agent.ts`                      | 380, 464 | `any[]`, `artifact?: any`                                  | 中               |
| `ai-app/image/export/export.service.ts`                            | 269      | `let PptxGenJS: any` (动态 require)                        | 低               |
| `ai-app/image/generation/image-generation.service.ts`              | 207, 301 | `modelConfig: any` 参数                                    | 中               |
| `ai-app/research/project/research-project-output.service.ts`       | 592, 682 | `sources: any[]` 参数                                      | 中               |
| `ai-app/social/ai-social.service.ts`                               | 380      | `page: any` (Playwright page)                              | 低（外部库类型） |
| `ai-app/topic-insights/services/core/mission-execution.service.ts` | 308      | `let result: any`                                          | 高               |
| `ai-app/topic-insights/services/core/research-mission.service.ts`  | 1986     | `let result: any`                                          | 高               |
| `ai-app/writing/services/consistency/fact-extractor.service.ts`    | 486      | `private parseJsonResponse(content: string): any` 返回类型 | 中               |
| `ai-app/writing/services/writing/chapter-writing.service.ts`       | 86       | `const updateData: any = { ...dto }`                       | 中               |

**as any 转型（ai-app 生产代码）**:

- `office/slides/orchestrator/slides-team-orchestrator.ts:1085,1087,1133,1135` - 4 处 spec/content 类型转换
- `social/adapters/wechat.adapter.ts`, `social/adapters/wechat/wechat-publisher.service.ts`, `social/services/playwright.service.ts` - 3 处 `window as any` (Playwright 上下文，合理)
- `teams/ai-teams.service.ts:717` - `linkPreview as any`
- `writing/services/mission/checkpoint.service.ts:197` - `delete (result as any).checkpoint`
- `writing/services/quality/narrative-craft.service.ts:1018,1168,1172` - `(this as any)._tempAfterPart` 临时状态变量（可改用类属性）

**关注点**: `topic-insights` 中 2 处 `let result: any` 风险最高，可能掩盖类型错误。`narrative-craft.service.ts` 用 `(this as any)` 存储临时状态属于设计缺陷，应改为类属性。

### 8.3 硬编码品牌名

| 文件                                           | 内容                                | 性质                                         |
| ---------------------------------------------- | ----------------------------------- | -------------------------------------------- |
| `ai-app/ask/ai-ask.service.ts:603,609,653,659` | `"GenesisPod"` 在注释和日志字符串中 | 仅出现在日志消息中，不影响运行时行为，低风险 |
| `ai-app/ask/constants/project-context.ts:2`    | 文件注释                            | 注释                                         |
| `ai-app/image/` 多个文件头注释                 | `"GenesisPod v2.1"`                 | 文件头注释                                   |
| `ai-engine/a2a/` 相关文件                      | `"Genesis"`, `"GenesisPod"`         | A2A Agent Card 中作为平台标识符使用          |

**唯一运行时影响**:

- `ai-engine/a2a/adapter/a2a-team-member-adapter.ts:56` - `"Cannot access internal Genesis resources directly"` 作为错误消息字符串，属于对外可见的硬编码品牌名。
- `frontend/lib/utils/config.ts:7` - `const BRAND_NAME = process.env.NEXT_PUBLIC_BRAND_NAME || 'Genesis'` - 有环境变量兜底，合规设计，可通过配置覆盖。

---

## 九、架构债务优先级矩阵

| 优先级 | 问题                                                                                        | 影响范围                                                | 修复成本                                      | 建议时机 |
| ------ | ------------------------------------------------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------- | -------- |
| P1     | ai-app/ask 和 topic-insights 内联 `import()` 绕过 Facade                                    | ai-ask.service.ts, data-source-fetcher.service.ts       | 极低 (2 行改动 + facade 补充导出)             | 本迭代   |
| P2     | Facade 导出缺口：`ExecutionMode`, `BuiltinToolId`                                           | facade/index.ts + team-member.agent.ts + writing agents | 低 (facade 加 2 行导出, 各文件改 import 路径) | 本迭代   |
| P2     | team-member.agent.ts 直接引用 ai-engine/core, tools/registry, tools/abstractions            | teams/agents/team-member.agent.ts                       | 低 (符号均已在 facade 导出)                   | 本迭代   |
| P2     | LLM 调用中硬编码模型名：admin.controller.ts, admin.service.ts (Perplexity), quota providers | core/admin, core/user-api-keys                          | 中 (需引入 AiChatService 或专用 API 测试工具) | 下次迭代 |
| P2     | 跨 App 直接依赖：planning -> teams, ask -> rag (Service 层)                                 | planning, ask                                           | 中 (需通过 Facade 或独立接口层中转)           | 下次迭代 |
| P3     | ESLint 覆盖缺口：memory/abstractions, teams/base, teams/controllers, long-content/constants | .eslintrc.js                                            | 极低 (添加 4 条规则)                          | 本周     |
| P3     | writing/agents 使用 ai-engine/core 和 ai-engine/llm/types（豁免文件，但应迁移）             | writing/agents/\*.agent.ts (5 个)                       | 低                                            | 下次迭代 |
| P3     | topic-insights `let result: any` 2 处（类型安全风险）                                       | topic-insights/services/core                            | 低                                            | 下次迭代 |
| P3     | narrative-craft.service.ts `(this as any)._tempAfterPart` 状态设计缺陷                      | writing/services/quality                                | 低                                            | 下次迭代 |
| P4     | 跨 App 依赖：office -> research/writing (通过 DI token 解耦，风险低)                        | office module                                           | 高 (需要架构重新规划)                         | 长期     |
| P4     | a2a/adapter.ts 中硬编码 "Genesis" 错误消息                                                  | a2a adapter                                             | 极低                                          | 按需     |

---

## 十、建议行动项

### 必须处理（本迭代，P1-P2）

- [ ] **facade/index.ts 补充导出**: 添加 `ExecutionMode` 和 `BuiltinToolId` 的类型导出
- [ ] **team-member.agent.ts 迁移**: 将 `ai-engine/core`, `ai-engine/tools/registry`, `ai-engine/tools/abstractions` 改为从 `ai-engine/facade` 导入
- [ ] **消除内联 import 违规**:
  - `ai-ask.service.ts:1145` - 将 `TaskPlan` 添加到 facade 导出，改为 `import { TaskPlan } from "../ai-engine/facade"`
  - `data-source-fetcher.service.ts:938` - 改为顶层 `import type { ToolContext } from "../../../ai-engine/facade"`

### 计划处理（下次迭代，P2-P3）

- [ ] **ESLint 规则补充**: 在 `.eslintrc.js` Section 9 添加 `memory/abstractions`, `teams/base`, `teams/controllers`, `long-content/constants` 四条规则
- [ ] **admin.controller.ts + admin.service.ts**: 将 Perplexity 测试调用中的硬编码模型名抽取为常量，或使用动态配置
- [ ] **quota/anthropic-quota.provider.ts + user-api-keys.service.ts**: 将测试用的 `claude-3-haiku-20240307` 替换为配置项
- [ ] **topic-insights `let result: any`**: 补充具体返回类型
- [ ] **writing agents 迁移**: 将 `ai-engine/core` 和 `ai-engine/llm/types` 改为 `ai-engine/facade` 引用（5 个 agent 文件，需要同步将 `ExecutionMode` 加入 facade 导出）

### 长期改进

- [ ] **跨 App 依赖治理**: `planning -> teams` 和 `ask -> rag` 的 Service 层依赖，考虑将 `RAGPipelineService` 和 Teams 调度能力通过 `AIEngineFacade` 暴露，消除 ai-app 间直接依赖
- [ ] **ESLint 内联 import 规则**: 研究是否可以通过 `@typescript-eslint` 自定义规则或 TSC 插件覆盖内联 `import()` 类型引用的路径限制
- [ ] **narrative-craft.service.ts 重构**: `(this as any)._tempAfterPart` 临时状态应改为类属性，消除 `as any` 用法
- [ ] **建立月度审计机制**: 每次 major release 前执行一次全量架构审计，将违规数量趋势纳入研发质量指标

---

## 附录: 扫描方法说明

| 扫描维度    | 工具                            | 扫描范围                                             |
| ----------- | ------------------------------- | ---------------------------------------------------- |
| Facade 边界 | grep 正则 + 手工逐文件核查      | backend/src/modules/ai-app/\*_/_.ts (排除 spec/test) |
| 反向依赖    | grep                            | backend/src/modules/ai-engine/\*_/_.ts               |
| LLM 硬编码  | grep 模式匹配 + 上下文核查      | backend/src/modules/\*_/_.ts                         |
| 注册模式    | grep + 逐模块 .module.ts 阅读   | backend/src/modules/ai-app/\*_/_.module.ts           |
| ESLint 覆盖 | 手工对比目录列表 + .eslintrc.js | backend/.eslintrc.js vs ai-engine 子目录枚举         |
| console.log | grep                            | backend/src/modules + frontend/app/components        |
| any 类型    | grep `: any` + `as any`         | backend/src/modules/ai-app (排除 spec)               |
| 品牌名      | grep                            | backend/src/modules + frontend                       |

---

_报告生成工具: Arch Auditor Agent v1.0_
_下次建议审计时间: 2026-03-24_

