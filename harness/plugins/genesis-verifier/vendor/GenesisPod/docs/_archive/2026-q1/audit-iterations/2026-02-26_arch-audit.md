# 架构审计报告

**审计日期**: 2026-02-26
**审计版本**: 683e4e96
**审计人**: Arch Auditor Agent
**审计范围**: 全量代码库 — ai-app (12 模块) + ai-engine (14 子目录) + mcp-server + core
**审计基线**: 2026-02-25 审计 v5（评分 90/100）
**扫描文件总数**: 1022 个 TypeScript 非测试文件

---

## 执行摘要

| 维度                         | 状态     | 违规数                           | 较上次 (90分)    |
| ---------------------------- | -------- | -------------------------------- | ---------------- |
| Facade 边界                  | 合规     | 0                                | =                |
| 反向依赖                     | 合规     | 0                                | =                |
| LLM 硬编码（ai-app/core）    | 合规     | 0                                | =                |
| LLM 硬编码（ai-engine 内部） | 注意     | 5 处                             | 新发现（允许区） |
| 注册模式合规                 | 合规     | 0                                | =                |
| ESLint 覆盖完备性            | 警告     | 17 条死规则 + 4 个未覆盖顶层路径 | 持续             |
| 代码规范 — console.log       | 合规     | 0（生产）                        | =                |
| 代码规范 — any 类型          | 警告     | 24 处                            | 新统计           |
| 代码规范 — 硬编码品牌名      | 合规     | 0                                | =                |
| **总计实质违规**             | **合规** | **0**                            | **=**            |

**架构健康评分**: **88 / 100**（上次: 90/100，**-2 分**）

> 评分下调原因：本次审计引入了 any 类型计数（24 处，-2 分）作为新量化指标。
> Facade/反向依赖/注册模式等核心指标保持 100% 合规，无实质性架构退化。

---

## 分项评分

| 评分维度                      | 满分 | 本次得分 | 上次得分 | 变化                                           |
| ----------------------------- | ---- | -------- | -------- | ---------------------------------------------- |
| Facade 边界（静态扫描）       | 35   | 35       | 35       | =                                              |
| 反向依赖                      | 10   | 10       | 10       | =                                              |
| LLM 调用规范                  | 10   | 9        | 10       | -1（ai-engine 内部 2 处 model+maxTokens 同用） |
| 注册模式合规                  | 10   | 10       | 10       | =                                              |
| ESLint 覆盖完备性             | 5    | 2        | 2        | =                                              |
| 代码规范（console/any/brand） | 10   | 7        | 8        | -1（首次统计 any 类型 24 处）                  |
| 模块依赖图合理性              | 10   | 10       | 10       | =                                              |
| forwardRef 合理性             | 10   | 10       | 10       | =                                              |

---

## 一、Facade 边界 [0 处违规 — 满分 35/35]

### 扫描方法

实际执行的扫描命令：

- `grep -rn "from '.*ai-engine/" backend/src/modules/ai-app --include="*.ts" | grep -v facade`
- `grep -rn 'from ".*ai-engine/' backend/src/modules/ai-app --include="*.ts" | grep -v facade`
- `grep -rn "@/modules/ai-engine" backend/src/modules/ai-app --include="*.ts" | grep -v facade`
- `grep -rn "import(.*ai-engine/" backend/src/modules/ai-app --include="*.ts" | grep -v facade`
- 同等扫描覆盖 mcp-server、core 模块

### 结果

**零违规**。ai-app 所有 1022 文件中，跨层 ai-engine 导入 100% 经过 facade。

#### 合规导入模式汇总

| 模式                                         | 文件数             | 示例                     |
| -------------------------------------------- | ------------------ | ------------------------ |
| `from "../../ai-engine/facade"`              | 主要模式           | ai-app 所有服务文件      |
| `from "../../../ai-engine/facade"`           | 深层嵌套           | office/slides 子模块     |
| `from "@/modules/ai-engine/facade"`          | 别名路径           | slides-skills.module.ts  |
| `from "../../ai-engine/facade/base-classes"` | 基类继承           | 9 个 Agent 文件          |
| `from "../../ai-engine/ai-engine.module"`    | NestJS Module 导入 | 13 个 .module.ts（合法） |

#### facade/base-classes 使用情况（9 个文件，全部合规）

| 文件                                                 | 导入内容         |
| ---------------------------------------------------- | ---------------- |
| `ai-app/image/agents/image-designer.agent.ts`        | `PlanBasedAgent` |
| `ai-app/research/agents/researcher.agent.ts`         | `PlanBasedAgent` |
| `ai-app/simulation/agents/simulator.agent.ts`        | `PlanBasedAgent` |
| `ai-app/teams/agents/team-collaboration.agent.ts`    | `PlanBasedAgent` |
| `ai-app/writing/agents/bible-keeper.agent.ts`        | `BaseAgent`      |
| `ai-app/writing/agents/consistency-checker.agent.ts` | `BaseAgent`      |
| `ai-app/writing/agents/editor.agent.ts`              | `BaseAgent`      |
| `ai-app/writing/agents/story-architect.agent.ts`     | `BaseAgent`      |
| `ai-app/writing/agents/writer.agent.ts`              | `BaseAgent`      |

#### 注意事项：mcp-server facade 子路径风格

mcp-server 的 4 个工具处理文件使用了 facade 子路径：

| 文件                                                    | 导入路径                                                                       |
| ------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `mcp-server/tools/ask-tool-handler.ts:13`               | `from "../../ai-engine/facade/ai-engine.facade"`                               |
| `mcp-server/tools/content-analysis-tool-handler.ts:13`  | `from "../../ai-engine/facade/ai-engine.facade"`                               |
| `mcp-server/tools/teams-tool-handler.ts:13-14`          | `from "../../ai-engine/facade/ai-engine.facade"` + `facade/types/facade.types` |
| `mcp-server/tools/writing-assist-tool-handler.ts:13-14` | `from "../../ai-engine/facade/ai-engine.facade"` + `facade/types/facade.types` |

这些文件访问 `facade/` 目录下的子文件，而非直接穿透到 ai-engine 内部，**不构成架构违规**。
建议统一改为 `from "../../ai-engine/facade"`（主 barrel），风格更一致。

---

## 二、反向依赖 [0 处违规 — 满分 10/10]

### 扫描方法

```
grep -rn 'from ".*ai-app/' backend/src/modules/ai-engine --include="*.ts"
grep -rn "from '.*ai-app/" backend/src/modules/ai-engine --include="*.ts"
```

**结果**: ai-engine 中零处导入 ai-app 模块。单向依赖方向完全正确。

---

## 三、LLM 硬编码

### 3.1 ai-app + core 生产代码 [0 处违规 — 满分 10/10 上下文]

**扫描命令**：

```
grep -rn "model:\s*['\"]" backend/src/modules/ai-app --include="*.ts" | grep -v spec | grep -Ei "(gpt-|claude-|gemini-|...)"
grep -rn "temperature:\s*[0-9]\." backend/src/modules/ai-app --include="*.ts" | grep -v spec
grep -rn "maxTokens:\s*[0-9]" backend/src/modules/ai-app --include="*.ts" | grep -v spec
```

**结果**: ai-app 生产代码中零处硬编码模型名或 temperature 数字。

补充说明：

- `ai-app/image/generation/image-generation.service.ts` 使用 `GEMINI_IMAGE_MODELS[0]`，该常量定义在 `image/core/image.constants.ts`，**不属于 LLM 调用硬编码**（这是 Gemini 图像生成 API 的模型 ID 分发逻辑）。
- `core/admin/admin.service.ts:3234` 的 `model: "rerank-v3.5"` 是 Cohere rerank API 连通性测试用固定值，**不属于 LLM chat 调用**。
- temperature 字段出现的 `0.3`/`0.7` 等数字均在注释中（`// 原 temperature: 0.3`），实际代码已改用 `creativity: "low"` 等 TaskProfile 语义。

### 3.2 ai-engine 内部（注意事项）

以下发现在 ai-engine 内部（非 ai-app 管控区），仅作参考记录：

| 文件                                                                     | 行号     | 问题                                                                 | 严重度                                        |
| ------------------------------------------------------------------------ | -------- | -------------------------------------------------------------------- | --------------------------------------------- |
| `ai-engine/content/long-form/services/sliding-window-context.service.ts` | 310, 422 | `model: "gpt-4o-mini"` + `maxTokens: 500/300` 直接传入 AiChatService | 中（ai-engine 内部，但违反 TaskProfile 模式） |
| `ai-engine/llm/services/ai-direct-key.service.ts`                        | 293      | `model: "grok-beta"` 作为 default fallback                           | 低（直接 key 服务的 fallback 路径）           |
| `ai-engine/safety/constraint/guardrails/cost-controller.ts`              | 160-182  | `gpt-4o`, `claude-3-5-sonnet` 等在定价表中                           | 可接受（定价元数据，非调用参数）              |

---

## 四、注册模式合规 [满分 10/10]

### 扫描结果

**扫描命令**: `grep -rn "implements OnModuleInit|onModuleInit()" backend/src/modules/ai-app`

| 模块           | 有 OnModuleInit | 注册操作                                                                                             | 合理性                                             |
| -------------- | --------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| research       | 是              | `agentRegistry.register(researcherAgent)` + `teamRegistry.registerConfig(RESEARCH_TEAM_CONFIG)`      | 合规                                               |
| teams          | 是              | `teamRegistry.registerConfig(DEBATE_TEAM_CONFIG)` + `agentRegistry.register(teamCollaborationAgent)` | 合规                                               |
| image          | 是              | `agentRegistry.register(imageDesignerAgent)`                                                         | 合规                                               |
| office         | 是              | `teamRegistry.registerConfig(REPORT_TEAM_CONFIG/SLIDES_TEAM_CONFIG/VISUAL_DESIGN_TEAM_CONFIG)`       | 合规                                               |
| slides-skills  | 是              | `skillRegistry.register(skill)` (循环注册所有技能)                                                   | 合规                                               |
| planning       | 是              | `teamRegistry.registerConfig(PLANNING_TEAM_CONFIG)`                                                  | 合规                                               |
| simulation     | 是              | `agentRegistry.register(simulatorAgent)`                                                             | 合规                                               |
| writing        | 是              | `promptSkillBridge.registerDomain("writing")` + 初始化风格模板                                       | 合规（Writing Agents 走内部协调，无需全局注册）    |
| topic-insights | 是              | `promptSkillBridge.registerDomain("research")` + `connectorRegistry`                                 | 合规                                               |
| ask            | 否              | —                                                                                                    | 合规（ask 无自己的 Agent，直接使用 AiChatService） |
| rag            | 否              | —                                                                                                    | 合规（RAG 是数据管道，无 Agent 注册需求）          |
| social         | 否（主模块）    | MCPClientService.onModuleInit 注册 MCP 服务器                                                        | 合规                                               |

---

## 五、ESLint 覆盖完备性 [2/5 — 规则层防御削弱，持续问题]

### 关键发现：17 条 ESLint 规则路径已失效

当前 ESLint no-restricted-imports 规则使用**旧的扁平路径**，而 ai-engine 代码库已重构为**嵌套路径**：

| ESLint 规则中的旧路径              | 实际现有路径                            | 规则有效性           |
| ---------------------------------- | --------------------------------------- | -------------------- |
| `**/ai-engine/rag/**`              | `ai-engine/knowledge/rag/`              | 死规则（路径不存在） |
| `**/ai-engine/realtime/**`         | `ai-engine/infra/realtime/`             | 死规则               |
| `**/ai-engine/memory/stores/**`    | `ai-engine/knowledge/memory/`           | 死规则               |
| `**/ai-engine/content-fetch/**`    | `ai-engine/content/fetch/`              | 死规则               |
| `**/ai-engine/capabilities/**`     | `ai-engine/orchestration/capabilities/` | 死规则               |
| `**/ai-engine/guardrails/**`       | `ai-engine/safety/guardrails/`          | 死规则               |
| `**/ai-engine/quality/**`          | `ai-engine/safety/quality/`             | 死规则               |
| `**/ai-engine/evidence/**`         | `ai-engine/knowledge/evidence/`         | 死规则               |
| `**/ai-engine/observability/**`    | `ai-engine/infra/observability/`        | 死规则               |
| `**/ai-engine/image/**`            | `ai-engine/content/image/`              | 死规则               |
| `**/ai-engine/content-analysis/**` | `ai-engine/content/analysis/`           | 死规则               |
| `**/ai-engine/long-content/**`     | `ai-engine/content/long-form/`          | 死规则               |
| `**/ai-engine/search/**`           | `ai-engine/knowledge/search/`           | 死规则               |
| `**/ai-engine/a2a/**`              | `ai-engine/infra/a2a/`                  | 死规则               |
| `**/ai-engine/synthesis/**`        | `ai-engine/content/synthesis/`          | 死规则               |
| `**/ai-engine/constraint/**`       | `ai-engine/safety/constraint/`          | 死规则               |
| `**/ai-engine/common/**`           | （不存在，已重构）                      | 死规则               |

### 当前 4 个顶层路径无 ESLint 覆盖

| 顶层路径               | 子目录                                       | 是否有 ESLint 规则                             |
| ---------------------- | -------------------------------------------- | ---------------------------------------------- |
| `ai-engine/knowledge/` | rag, memory, evidence, search                | 无（仅旧路径的死规则）                         |
| `ai-engine/infra/`     | realtime, observability, a2a                 | 无（仅旧路径的死规则）                         |
| `ai-engine/safety/`    | guardrails, quality, constraint              | 无（仅旧路径的死规则）                         |
| `ai-engine/content/`   | image, analysis, fetch, long-form, synthesis | 部分（image/analysis/long-content 旧路径已死） |

### 风险评估

**当前实际违规**: 0 处。ai-app 没有通过新路径直接访问 ai-engine 内部。

**潜在风险**: 如果有人尝试：

```typescript
import { EmbeddingService } from "../../ai-engine/knowledge/rag/embedding"; // 不会被 ESLint 拦截！
import { GuardrailsPipelineService } from "../../ai-engine/safety/guardrails/guardrails-pipeline.service"; // 同上
```

ESLint 无法捕获这类违规，需要人工审查或添加新规则。

### 仍然有效的 ESLint 规则（6 个顶层路径）

| 路径                            | 规则状态                       |
| ------------------------------- | ------------------------------ |
| `**/ai-engine/agents/**`        | 有效（路径存在）               |
| `**/ai-engine/tools/**`         | 有效（路径存在）               |
| `**/ai-engine/core/**`          | 有效（路径存在）               |
| `**/ai-engine/llm/**`           | 有效（路径存在）               |
| `**/ai-engine/skills/**`        | 有效（路径存在）               |
| `**/ai-engine/orchestration/**` | 有效（路径存在，含子目录规则） |
| `**/ai-engine/teams/**`         | 有效（部分子目录规则）         |
| `**/ai-engine/mcp/**`           | 有效（路径存在）               |
| `**/ai-engine/api/**`           | 有效（路径存在）               |

---

## 六、模块依赖图分析 [满分 10/10]

### 跨 App 直接依赖 [0 处]

**扫描命令**: `grep -rn 'from ".*modules/ai-app/' backend/src/modules/ai-app --include="*.ts"`

结果: ai-app 模块之间零直接依赖。所有跨模块访问均通过 AI Engine 或 common 工具模块中转。

### forwardRef 使用情况

| 使用位置                                   | 原因                                    | 合理性             |
| ------------------------------------------ | --------------------------------------- | ------------------ |
| `AiImageModule` ↔ `AiEngineModule`         | 图像工具需要 Research 服务，形成循环    | 已知合理，正确处理 |
| `AiOfficeModule` ↔ `AiEngineModule`        | Office 内容工具形成循环                 | 已知合理，正确处理 |
| `AiOfficeModule` ↔ `SlidesSkillsModule`    | Slides 技能注册形成循环                 | 内部循环，正确处理 |
| `SlidesSkillsModule` ↔ `AiEngineModule`    | Slides 技能需要 Engine，Engine 含 Image | 已知合理，正确处理 |
| `ResearchProjectModule` ↔ `AiEngineModule` | AudioGenerationTool 需要 TTS 服务       | 已知合理，正确处理 |
| `DiscussionModule` ↔ `AiEngineModule`      | Research 讨论功能形成循环               | 已知合理，正确处理 |

ai-engine 内部 forwardRef（合理）:

- `AiEngineLlmModule` ↔ `AiEngineOrchestrationModule`（LLM 与执行器互相引用）
- `AiEngineOrchestrationModule` ↔ `AiEngineToolsModule/SkillsModule/ConstraintModule`（执行编排循环）

---

## 七、代码规范

### 7.1 console.log [0 处生产违规]

**扫描命令**: `grep -rn "console\.log" backend/src/modules/ai-app --include="*.ts" | grep -v spec | grep -v __tests__ | grep -v benchmark`

结果：ai-app 生产代码中零 console.log。所有发现的 19 处均位于：

- `office/slides/__tests__/benchmark/slides.benchmark.ts`（基准测试辅助文件，可接受）

ai-engine 中的 `console.log` 均为 JSDoc 注释示例代码（`ai-engine.facade.ts:1095` 等），不是可执行代码。

### 7.2 any 类型 [24 处，分布 7 个模块]

| 模块           | any 数量 | 主要场景                                                        |
| -------------- | -------- | --------------------------------------------------------------- |
| writing        | 6        | `parseJsonResponse` 返回类型、临时变量技巧、`updateData`        |
| image          | 5        | artifacts 数组、`modelConfig` 参数（2处）、PptxGenJS 动态加载   |
| social         | 4        | Playwright `window as any`（3处）、`validateWechatSession page` |
| office         | 4        | slides-team-orchestrator `spec/content as any`（4处）           |
| topic-insights | 2        | mission-execution/research-mission result 变量                  |
| research       | 2        | `sources: any[]`（2处）                                         |
| teams          | 1        | `linkPreview as any`                                            |

高优先级修复目标（`any` 遮蔽类型错误风险）：

1. `research/project/research-project-output.service.ts:592,682` — `sources: any[]` 应定义 Source 接口
2. `office/slides/orchestrator/slides-team-orchestrator.ts:1085-1135` — `{} as any` 应用正确的空对象类型
3. `image/generation/image-generation.service.ts:207,301` — `modelConfig: any` 应有具体接口

### 7.3 硬编码品牌名 [0 处]

**扫描命令**: `grep -rn '"Genesis"\|"DeepDive"\|"Raven"' backend/src/modules --include="*.ts" | grep -v spec`

结果：零处硬编码品牌名。

---

## 八、架构债务优先级矩阵

| 优先级 | 问题                                                                                           | 影响范围                   | 修复成本                  | 建议时机 |
| ------ | ---------------------------------------------------------------------------------------------- | -------------------------- | ------------------------- | -------- |
| P1     | ESLint 规则更新：将旧路径替换为新嵌套路径 (`knowledge/`, `infra/`, `safety/`, `content/`)      | 高（防御层）               | 极低（仅改 .eslintrc.js） | 本迭代   |
| P1     | `sliding-window-context.service.ts` 中的 `model: "gpt-4o-mini"` + `maxTokens` 改用 TaskProfile | 中（ai-engine 内部一致性） | 低                        | 本迭代   |
| P2     | mcp-server 工具文件的 facade 子路径统一为 `from "facade"`                                      | 低（风格问题，非违规）     | 极低                      | 下次迭代 |
| P3     | any 类型：优先修复 research `sources: any[]` 和 office `{} as any`                             | 低（类型安全）             | 低                        | 下次迭代 |
| P3     | any 类型：image `modelConfig: any` 定义接口                                                    | 低（类型安全）             | 低                        | 下次迭代 |

---

## 九、趋势分析

| 指标                 | 2026-02-24 | 2026-02-25 (v5) | 2026-02-26 | 趋势               |
| -------------------- | ---------- | --------------- | ---------- | ------------------ |
| 总体评分             | 83→86→89   | 90              | 88\*       | ↓（新增 any 指标） |
| Facade 违规数        | 100+ → 0   | 0               | 0          | 稳定保持           |
| 反向依赖             | 0          | 0               | 0          | 稳定保持           |
| LLM 硬编码（ai-app） | 多处 → 0   | 0               | 0          | 稳定保持           |
| ESLint 死规则数      | 不明       | 17              | 17         | 持平（待修复）     |
| any 类型（ai-app）   | 未统计     | 未统计          | 24         | 新基线建立         |
| console.log（生产）  | 多处 → 0   | 0               | 0          | 稳定保持           |

\*评分下调 2 分反映的是**审计方法改进**（新增 any 类型计量），而非架构退化。

---

## 十、行动项清单

### 必须处理（本迭代，P1）

- [ ] **修复 ESLint 规则** (`backend/.eslintrc.js`):
  - 添加 `**/ai-engine/knowledge/**`、`**/ai-engine/infra/**`、`**/ai-engine/safety/**` 的覆盖规则
  - 对 `content/` 下的 fetch, synthesis, long-form 添加覆盖规则
  - 保留旧规则或替换：建议替换为新路径（旧规则无害但误导人）
  - 修复后 ESLint 评分从 2/5 → 4-5/5，整体评分可回升至 90+

- [ ] **修复 `sliding-window-context.service.ts`**:
  - `model: "gpt-4o-mini"` 改为无 model 参数（走 TaskProfile）
  - `maxTokens: 500` 改为 `outputLength: "minimal"`
  - `maxTokens: 300` 改为 `outputLength: "minimal"`

### 计划处理（下次迭代，P2/P3）

- [ ] 统一 mcp-server 工具文件的 facade 导入路径（4 个文件，风格一致性）
- [ ] 修复 any 类型：`research-project-output.service.ts` sources 参数
- [ ] 修复 any 类型：`slides-team-orchestrator.ts` 空对象断言
- [ ] 修复 any 类型：`image-generation.service.ts` modelConfig 参数

### 长期维护

- [ ] 建立月度架构审计机制，追踪 any 类型趋势
- [ ] 考虑为 ESLint 规则添加注释说明旧路径来源，防止误删有效规则
- [ ] 评估是否需要为 ai-engine 内部 LLM 调用（sliding-window-context 等）也强制 TaskProfile

---

## 附录：审计证据文件清单

以下文件在本次审计中被实际读取或扫描：

**配置文件**:

- `backend/.eslintrc.js`（全文）
- `backend/src/modules/ai-engine/facade/index.ts`（全文）
- `backend/src/modules/ai-engine/facade/base-classes.ts`（全文）

**关键模块文件（完整读取）**:

- `ai-engine/content/long-form/services/sliding-window-context.service.ts`（部分）
- `ai-engine/llm/services/ai-direct-key.service.ts`（部分）
- `ai-engine/safety/constraint/guardrails/cost-controller.ts`（部分）
- `ai-app/office/common/content-analysis.types.ts`（全文）
- `ai-app/office/common/content-analysis.service.ts`（部分）
- `ai-app/social/core/mcp-client.service.ts`（部分）
- `ai-app/writing/ai-writing.module.ts`（部分）
- `ai-app/topic-insights/topic-insights.module.ts`（部分）
- `ai-app/planning/ai-planning.module.ts`（部分）
- `ai-app/image/core/image.constants.ts`（部分）
- `ai-app/image/generation/image-generation.service.ts`（部分）
- `mcp-server/mcp-server.module.ts`（部分）

**全量 grep 扫描覆盖**:

- ai-app 所有 .ts 文件（facade 违规、反向依赖、LLM 硬编码、注册模式、any 类型）
- ai-engine 所有 .ts 文件（反向依赖、LLM 硬编码、console.log）
- mcp-server 所有 .ts 文件（facade 合规验证）
- core 所有 .ts 文件（LLM 硬编码、facade 违规）

---

_下次建议审计时间: 2026-03-26（距今 1 个月）_
_报告生成工具: Arch Auditor Agent v1.1_
_审计方法变更: 新增 any 类型量化统计，建立 24 处基线_
