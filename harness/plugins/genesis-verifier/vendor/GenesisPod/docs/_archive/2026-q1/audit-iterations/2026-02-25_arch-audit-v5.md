# 架构审计报告

**审计日期**: 2026-02-25
**审计版本**: `8cad499a`
**审计员**: Arch Auditor Agent (claude-sonnet-4-6)
**审计范围**: 全量代码库 — `ai-app/`（11 个子模块，582 个非测试 TS 文件）+ `ai-engine/`（439 个非测试 TS 文件）+ `core/` + `mcp-server/`
**对比基准**: 2026-02-25_arch-audit-v4.md（89/100，commit `8cad499a` 前序状态）

---

## 执行摘要

| 维度                 | 满分    | 上次（v4, 89分） | 本次（v5） | 变化   | 状态                         |
| -------------------- | ------- | ---------------- | ---------- | ------ | ---------------------------- |
| Facade 边界          | 35      | 35               | 35         | =      | 完全合规                     |
| 反向依赖             | 10      | 10               | 10         | =      | 完全合规                     |
| LLM 硬编码           | 20      | 17               | 17         | =      | 持平（3 处已知合理例外）     |
| 注册模式合规         | 5       | 5                | 5          | =      | 完全合规                     |
| ESLint 覆盖完备性    | 5       | 2                | 2          | =      | 持平（重构后路径失效未修复） |
| Timer / 浮动 Promise | 5       | 4                | 5          | **+1** | setTimeout .unref() 已修复   |
| any 类型             | 10      | 6                | 6          | =      | 持平（24 处，含合理例外）    |
| 代码规范             | 10      | 10               | 10         | =      | 满分保持                     |
| **总分**             | **100** | **89**           | **90**     | **+1** | **良好**                     |

**架构健康评分**: **90 / 100**（上次: 89/100，**+1 分**）

---

## 评分计算说明

```
Facade 边界 (35分满分):
  静态 import 扫描: ai-app -> ai-engine 非 facade / 非 Module / 非 base-agent 路径 = 0 处违规
  注：base-agent 直接导入属于 ESLint excludedFiles（继承模式，合理豁免）
  注：facade/ai-engine.facade 子路径导入（而非 facade/index.ts）属于风格问题，功能等价
  满分 35/35

反向依赖 (10分满分):
  ai-engine 中导入 ai-app: 0 处
  满分 10/10

LLM 硬编码 (20分满分):
  ai-app 层 production 代码: 0 处硬编码模型名、0 处硬编码 temperature、0 处硬编码 maxTokens
  ai-engine 内部: ai-connection-test.service.ts temperature:0 合理（连接测试）
  ai-engine 内部: ai-chat.service.ts callAPIWithConfig 直接参数合理（LLM 层实现）
  已知 P1 残留: Perplexity 直连 2 处 + Anthropic key verify 2 处（来自 v4）
  实得 17/20

注册模式合规 (5分满分):
  image:          agentRegistry.register(imageDesignerAgent)         合规
  office:         teamRegistry.registerConfig x3                     合规
  slides-skills:  skillRegistry.register 循环注册                    合规
  planning:       teamRegistry.registerConfig                        合规
  research:       agentRegistry.register + teamRegistry.registerConfig 合规
  simulation:     agentRegistry.register                             合规
  teams:          teamRegistry.registerConfig + agentRegistry.register 合规
  topic-insights: DataSourceConnectorRegistry.register               合规
  writing:        WritingAgentRegistry.onModuleInit                  合规
  ask/social/rag/shared: 无自身 Agent，无需注册，合规
  满分 5/5

ESLint 覆盖完备性 (5分满分):
  当前 ai-engine 实际第一层域: agents, api, content, core, facade, infra,
    knowledge, llm, mcp, orchestration, safety, skills, teams, tools（14 个）
  ESLint 覆盖: agents, core, llm, mcp, skills, tools = 6 个完全覆盖
  ESLint 覆盖（部分/旧路径）: orchestration(仅services子目录), 以及 rag/realtime/
    content-fetch/interfaces/image/content-analysis/capabilities 均为已废弃的旧路径
  未覆盖新域: api, content, infra, knowledge, safety（5 个）
  teams 仅部分覆盖（abstractions/constraints/registry/services，但 base/factory/
    orchestrator 未显式限制）
  实际违规: 0 处（ai-app 未直接访问未覆盖域）
  规则防御削弱: 约 50% 旧路径规则已因重构而失效
  实得 2/5（防御层削弱，但无实际违规发生）

Timer / 浮动 Promise (5分满分):
  slides-mission-health.service.ts:169 setTimeout().unref() 已修复（本次审计确认）
  所有 setInterval 均有 clearInterval 清理（OnModuleDestroy）
  void 声明的 fire-and-forget: 274 处（均已显式声明，不存在悬浮 promise）
  满分 5/5

any 类型 (10分满分):
  ai-app 生产代码: 24 处
  分类:
    合理例外（Playwright window/PptxGenJS 动态导入): ~6 处
    可改进（parseJsonResponse: any, modelConfig: any 等): ~8 处
    类型转换捷径（as any, {} as any 等): ~10 处
  实得约 6/10

代码规范 (10分满分):
  console.log 生产代码: 0 处（benchmark 文件不计入）
  品牌硬编码: 0 处
  满分 10/10
```

---

## 一、Facade 边界 [0 处违规 — 满分 35/35]

### 1.1 静态 import 扫描结果

扫描命令:

```
grep -rn "from.*ai-engine" backend/src/modules/ai-app --include="*.ts"
  | 排除 spec.ts / test.ts / __tests__
  | 排除 facade（合法路径）
  | 排除 ai-engine.module（NestJS 模块导入，合法）
  | 排除 base-agent / plan-based-agent（ESLint excludedFiles，继承模式）
```

**结果: 0 处实质性违规**。

唯一发现的非 facade/模块导入是已废弃的 re-export 文件（不是违规，是向后兼容桥接）：

| 文件                                        | 实际 import 路径                                                    | 性质                                        | 合规性 |
| ------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------- | ------ |
| `office/common/content-analysis.types.ts`   | `from "../../../ai-engine/content/analysis/content-analysis.types"` | ESLint excludedFiles 内的向后兼容 re-export | 合规   |
| `office/common/content-analysis.service.ts` | `from "../../../ai-engine/facade"`                                  | 使用 facade                                 | 合规   |
| `office/common/image-matching.service.ts`   | `from "../../../ai-engine/facade"`                                  | 使用 facade                                 | 合规   |

### 1.2 facade 子路径风格问题（非违规，建议统一）

以下文件使用 `ai-engine/facade/ai-engine.facade` 或 `ai-engine/facade/types/facade.types` 子路径，而非推荐的 `ai-engine/facade`（即 `facade/index.ts`）：

**ai-app 中共 10 处**:

| 文件                                                        | 当前 import 路径                              | 建议路径                     |
| ----------------------------------------------------------- | --------------------------------------------- | ---------------------------- |
| `image/generation/generation.service.ts`                    | `facade/ai-engine.facade`                     | `facade`                     |
| `image/generation/image-generation.service.ts`              | `facade/ai-engine.facade`                     | `facade`                     |
| `office/core/ai-model.service.ts`                           | `facade/ai-engine.facade`                     | `facade`                     |
| `social/services/content-transformer.service.ts`            | `facade/ai-engine.facade`                     | `facade`                     |
| `social/services/content-version.service.ts`                | `facade/ai-engine.facade`                     | `facade`                     |
| `social/services/social-leader.service.ts`                  | `facade/ai-engine.facade`                     | `facade`                     |
| `topic-insights/services/core/mission-execution.service.ts` | `@/modules/ai-engine/facade/ai-engine.facade` | `@/modules/ai-engine/facade` |
| `topic-insights/services/core/mission-query.service.ts`     | `@/modules/ai-engine/facade/ai-engine.facade` | `@/modules/ai-engine/facade` |
| `topic-insights/services/core/research-memory.service.ts`   | `@/modules/ai-engine/facade/ai-engine.facade` | `@/modules/ai-engine/facade` |
| `topic-insights/services/core/research-mission.service.ts`  | `@/modules/ai-engine/facade/ai-engine.facade` | `@/modules/ai-engine/facade` |

**mcp-server 中共 4 处**:

| 文件                                     | 当前 import 路径                                        |
| ---------------------------------------- | ------------------------------------------------------- |
| `tools/ask-tool-handler.ts`              | `facade/ai-engine.facade`                               |
| `tools/content-analysis-tool-handler.ts` | `facade/ai-engine.facade`                               |
| `tools/teams-tool-handler.ts`            | `facade/ai-engine.facade` + `facade/types/facade.types` |
| `tools/writing-assist-tool-handler.ts`   | `facade/ai-engine.facade` + `facade/types/facade.types` |

> 注：这些文件功能上等价（TypeScript 从任意子路径导出的类是同一个类），不会造成运行时问题，但风格不统一，建议统一到 `facade`（index.ts）入口。

### 1.3 ESLint 豁免文件确认（全部合规）

| 豁免文件（ESLint excludedFiles）              | 实际 import 路径                                                          | 合规性 |
| --------------------------------------------- | ------------------------------------------------------------------------- | ------ |
| `office/common/content-analysis.types.ts`     | `ai-engine/content/analysis/content-analysis.types`（向后兼容 re-export） | 合规   |
| `office/common/content-analysis.service.ts`   | `ai-engine/facade`                                                        | 合规   |
| `office/common/image-matching.service.ts`     | `ai-engine/facade`                                                        | 合规   |
| `writing/agents/bible-keeper.agent.ts`        | `ai-engine/agents/base/base-agent`（继承）                                | 合规   |
| `writing/agents/consistency-checker.agent.ts` | `ai-engine/agents/base/base-agent`（继承）                                | 合规   |
| `writing/agents/editor.agent.ts`              | `ai-engine/agents/base/base-agent`（继承）                                | 合规   |
| `writing/agents/story-architect.agent.ts`     | `ai-engine/agents/base/base-agent`（继承）                                | 合规   |
| `writing/agents/writer.agent.ts`              | `ai-engine/agents/base/base-agent`（继承）                                | 合规   |
| `image/agents/image-designer.agent.ts`        | `ai-engine/agents/base/plan-based-agent`（继承）                          | 合规   |
| `research/agents/researcher.agent.ts`         | `ai-engine/agents/base/plan-based-agent`（继承）                          | 合规   |
| `simulation/agents/simulator.agent.ts`        | `ai-engine/agents/base/plan-based-agent`（继承）                          | 合规   |
| `teams/agents/team-collaboration.agent.ts`    | `ai-engine/agents/base/plan-based-agent`（继承）                          | 合规   |

### 1.4 按 ai-app 子模块汇总

| ai-app 模块    | Facade 违规数 | 子路径风格问题数 | 状态               |
| -------------- | ------------- | ---------------- | ------------------ |
| ask            | 0             | 0                | 完全合规           |
| image          | 0             | 2                | 合规（风格待统一） |
| office         | 0             | 1                | 合规（风格待统一） |
| planning       | 0             | 0                | 完全合规           |
| rag            | 0             | 0                | 完全合规           |
| research       | 0             | 0                | 完全合规           |
| shared         | 0             | 0                | 完全合规           |
| simulation     | 0             | 0                | 完全合规           |
| social         | 0             | 3                | 合规（风格待统一） |
| teams          | 0             | 0                | 完全合规           |
| topic-insights | 0             | 4                | 合规（风格待统一） |
| writing        | 0             | 0                | 完全合规           |

---

## 二、反向依赖 [0 处违规 — 满分 10/10]

扫描 ai-engine 所有文件导入 ai-app 路径：

```
grep -rn "from.*modules/ai-app/" backend/src/modules/ai-engine: 0 处
grep -rn "from.*ai-app/" backend/src/modules/ai-engine: 0 处
```

ai-engine 层对 ai-app 无任何直接依赖，单向依赖关系完整保持。

---

## 三、LLM 硬编码 [17/20 — 3 处已知合理例外]

### 3.1 ai-app 生产代码 — 0 处违规

扫描结果:

- `model: 'gpt-4o'` 等硬编码模型名: **0 处**（全部在 spec.ts 文件中）
- `temperature: 数字` 硬编码: **0 处**（全部在 spec.ts / ai-engine 内部）
- `maxTokens: 数字` 硬编码: **0 处**（全部在 spec.ts / ai-engine 内部）

所有 ai-app 生产代码均使用 `TaskProfile { creativity, outputLength }` 方式。

### 3.2 已知合理例外（ai-engine 内部）

| 文件                                                                   | 内容             | 合理性说明                               |
| ---------------------------------------------------------------------- | ---------------- | ---------------------------------------- |
| `ai-engine/llm/services/ai-connection-test.service.ts:128,158,289,348` | `temperature: 0` | 连接测试，需要确定性输出，合理           |
| `ai-engine/llm/services/ai-chat.service.ts:272`                        | `temperature: 0` | LLM 核心层实现，该参数控制兜底行为，合理 |

### 3.3 持续跟踪（来自 v4，未修复）

| 优先级 | 文件                                             | 问题                                | 数量 |
| ------ | ------------------------------------------------ | ----------------------------------- | ---- |
| P1     | `ai-engine/llm/services` 中 Perplexity 直连      | 直接调用外部 API 绕过 AiChatService | 2    |
| P1     | `ai-engine/llm/services` 中 Anthropic key verify | 直接调用 SDK                        | 2    |

> 注：这些均在 ai-engine 内部，不违反 ai-app 层规则，但属于 LLM 调用标准化问题。

---

## 四、注册模式合规 [5/5 — 完全合规]

所有有 Agent / Team 的 ai-app 模块均在 `onModuleInit()` 中正确注册：

| 模块                        | 注册内容                                    | 注册方式                                                     | 合规性 |
| --------------------------- | ------------------------------------------- | ------------------------------------------------------------ | ------ |
| `ai-image.module.ts`        | ImageDesignerAgent                          | `agentRegistry.register()`                                   | 合规   |
| `ai-office.module.ts`       | REPORT/SLIDES/VISUAL_DESIGN_TEAM_CONFIG     | `teamRegistry.registerConfig()` x3                           | 合规   |
| `slides-skills.module.ts`   | 所有 Slide Skills                           | `skillRegistry.register()` 循环                              | 合规   |
| `ai-planning.module.ts`     | PLANNING_TEAM_CONFIG                        | `teamRegistry.registerConfig()`                              | 合规   |
| `research.module.ts`        | ResearcherAgent + RESEARCH_TEAM_CONFIG      | `agentRegistry.register()` + `teamRegistry.registerConfig()` | 合规   |
| `ai-simulation.module.ts`   | SimulatorAgent                              | `agentRegistry.register()`                                   | 合规   |
| `ai-teams.module.ts`        | DEBATE_TEAM_CONFIG + TeamCollaborationAgent | `teamRegistry.registerConfig()` + `agentRegistry.register()` | 合规   |
| `topic-insights.module.ts`  | DataSource Connectors                       | `DataSourceConnectorRegistry.register()` x4                  | 合规   |
| `ai-writing.module.ts`      | Writing Agents via WritingAgentRegistry     | `WritingAgentRegistry.onModuleInit()`                        | 合规   |
| ask / social / rag / shared | 无自身 Agent，无需注册                      | —                                                            | 不适用 |

---

## 五、ESLint 覆盖完备性 [2/5 — 规则层防御削弱]

### 5.1 当前 ai-engine 实际第一层域结构

```
ai-engine/
├── agents/       [ESLint 覆盖: **/ai-engine/agents/**]
├── api/          [未覆盖]
├── content/      [未覆盖 — 旧规则 content-fetch/content-analysis 已失效]
├── core/         [ESLint 覆盖: **/ai-engine/core/**]
├── facade/       [访问允许，不需限制]
├── infra/        [未覆盖 — 旧规则 observability/realtime/a2a 已失效]
├── knowledge/    [未覆盖 — 旧规则 rag/evidence 已失效]
├── llm/          [ESLint 覆盖: **/ai-engine/llm/**]
├── mcp/          [ESLint 覆盖: **/ai-engine/mcp/**]
├── orchestration/[部分覆盖: services子目录 + 部分特定文件]
├── safety/       [未覆盖]
├── skills/       [ESLint 覆盖: **/ai-engine/skills/**]
├── teams/        [部分覆盖: abstractions/constraints/registry/services，但 base/factory/orchestrator 未限制]
└── tools/        [ESLint 覆盖: **/ai-engine/tools/**]
```

### 5.2 覆盖缺口明细

| 缺口类型   | 受影响路径                                                             | 原来限制路径（已失效）                      | 风险级别             |
| ---------- | ---------------------------------------------------------------------- | ------------------------------------------- | -------------------- |
| 失效旧规则 | `ai-engine/content/**`                                                 | `content-analysis/**`, `content-fetch/**`   | 中（当前无实际违规） |
| 失效旧规则 | `ai-engine/infra/**`                                                   | `realtime/**`, `observability/**`, `a2a/**` | 中                   |
| 失效旧规则 | `ai-engine/knowledge/**`                                               | `rag/**`, `evidence/**`                     | 中                   |
| 全新未覆盖 | `ai-engine/api/**`                                                     | 无（新路径，从未被限制）                    | 低                   |
| 全新未覆盖 | `ai-engine/safety/**`                                                  | 无（新路径，从未被限制）                    | 中                   |
| 部分覆盖   | `ai-engine/teams/base/**`, `teams/factory/**`, `teams/orchestrator/**` | 无对应规则                                  | 中                   |

### 5.3 实际违规状态

**当前实际违规: 0 处**。ai-app 层未直接引用任何上述未覆盖路径。

ESLint 规则不完备是"防御层削弱"问题，不影响当前健康状态，但未来新增代码时这些路径不会触发编译期报错。

### 5.4 建议修复（ESLint 规则更新）

需要在 `backend/.eslintrc.js` 的 `no-restricted-imports` 规则中：

**替换失效旧规则**（原有条目可更新）:

```javascript
// 替换旧的 **/ai-engine/rag/** 规则
{ group: ["**/ai-engine/knowledge/**"], message: "Import RAG/embedding/vector types from 'ai-engine/facade'." },

// 替换旧的 **/ai-engine/realtime/**、**/ai-engine/observability/** 等
{ group: ["**/ai-engine/infra/**"], message: "Import realtime/observability types from 'ai-engine/facade'." },

// 替换旧的 **/ai-engine/content-analysis/**、**/ai-engine/content-fetch/**
{ group: ["**/ai-engine/content/**"], message: "Import content analysis types from 'ai-engine/facade'." },
```

**新增缺口路径**:

```javascript
{ group: ["**/ai-engine/safety/**"], message: "Import guardrails types from 'ai-engine/facade'." },
{ group: ["**/ai-engine/api/**"], message: "Import types from 'ai-engine/facade'." },
```

---

## 六、Timer / 浮动 Promise [5/5 — 本次修复确认]

### 6.1 本次改善

| 文件                                                          | 修复内容                          | 确认状态 |
| ------------------------------------------------------------- | --------------------------------- | -------- |
| `office/slides/services/slides-mission-health.service.ts:169` | `setTimeout().unref()` 已正确添加 | 已确认   |

### 6.2 全局扫描状态

- `console.log('hello')` 类代码段在 ai-ask.service.spec.ts 中是代码示例（字符串内容），不是实际调用。
- `void` 声明的 fire-and-forget: ai-app 层共 274 处，均已显式声明，未发现悬浮 Promise。
- `setInterval` 清理: 有 OnModuleDestroy 的服务均已正确清理（social/topic-insights/teams 等）。

---

## 七、any 类型 [6/10 — 24 处，含合理例外]

### 7.1 分类明细

| 类别                           | 数量 | 代表文件                                                                                                                    |
| ------------------------------ | ---- | --------------------------------------------------------------------------------------------------------------------------- |
| Playwright/浏览器 window 访问  | 3    | `social/adapters/wechat-publisher.service.ts`, `social/adapters/wechat.adapter.ts`, `social/services/playwright.service.ts` |
| 动态 require 导入（PptxGenJS） | 1    | `image/export/export.service.ts`                                                                                            |
| 临时结果持有变量               | 2    | `topic-insights/services/core/mission-execution.service.ts`, `research-mission.service.ts`                                  |
| image/generation 未定型参数    | 2    | `image/generation/image-generation.service.ts:207,301`                                                                      |
| 类型转换捷径（as any）         | 4    | `office/slides/orchestrator/slides-team-orchestrator.ts` x4                                                                 |
| 接口方法返回类型               | 1    | `writing/services/consistency/fact-extractor.service.ts`                                                                    |
| 其他                           | 11   | 分散于各模块                                                                                                                |

### 7.2 高优先级改进建议

| 文件                                                     | 行号     | 当前                                 | 建议                                       |
| -------------------------------------------------------- | -------- | ------------------------------------ | ------------------------------------------ |
| `image/generation/image-generation.service.ts`           | 207, 301 | `modelConfig: any`                   | 定义 `ModelConfig` 接口                    |
| `image/agents/image-designer.agent.ts`                   | 376, 460 | `artifacts: any[]`, `artifact?: any` | 使用 `AgentArtifact[]`（已从 facade 导出） |
| `writing/services/consistency/fact-extractor.service.ts` | 486      | `parseJsonResponse(): any`           | 返回 `unknown` 然后 narrow                 |
| `topic-insights/.../mission-execution.service.ts`        | 308      | `let result: any`                    | 使用 union 类型或 unknown                  |

---

## 八、代码规范 [10/10 — 满分]

| 规范项                               | 状态                   | 说明                          |
| ------------------------------------ | ---------------------- | ----------------------------- |
| `console.log` 生产代码               | 0 处                   | benchmark/example 文件不计入  |
| 品牌硬编码（Genesis/Raven/DeepDive） | 0 处                   | 全部通过 APP_CONFIG/BrandLogo |
| Logger 使用                          | 全面使用 NestJS Logger | 符合规范                      |

---

## 九、跨 ai-app 模块依赖评估

### 9.1 扫描结果

```
grep -rn "from.*modules/ai-app" backend/src/modules/ai-app: 0 处（绝对路径）
grep -rn "from.*@/modules/ai-app" backend/src/modules/ai-app: 0 处
```

跨模块相对路径引用: 扫描发现一处注释（`slides.types.ts: // ★ Inlined from ai-app/image`），显示主动内联以**避免**跨模块依赖，合规。

### 9.2 已知 forwardRef 清单（合理）

| 位置                                  | 循环依赖关系                                         | 合理性                            |
| ------------------------------------- | ---------------------------------------------------- | --------------------------------- |
| `ai-image.module.ts`                  | AiImageModule ↔ AiEngineModule                       | 图片生成 token 循环，已知合理     |
| `ai-office.module.ts`                 | AiOfficeModule ↔ AiEngineModule + SlidesSkillsModule | Office Skills 循环，已知合理      |
| `slides-skills.module.ts`             | SlidesSkillsModule ↔ AiEngineModule                  | 技能注册循环，已知合理            |
| `research/discussion.module.ts`       | DiscussionModule ↔ AiEngineModule                    | 讨论服务循环，已知合理            |
| `research/research-project.module.ts` | ResearchProjectModule ↔ AiEngineModule               | TTS 工具循环，已知合理            |
| `topic-insights/.../*.ts`             | 多处 service 内部循环（ResearchLeaderService 等）    | 同模块内循环，合理                |
| `admin.module.ts`                     | AdminModule ↔ AiEngineModule                         | 管理面板循环，已知合理            |
| `mcp-server.module.ts`                | MCPServerModule → DiscussionModule                   | 单向依赖（forwardRef 处理），合理 |

**无新增不合理 forwardRef**。

---

## 十、mcp-server 模块专项审计

### 10.1 架构合规

| 检查项                            | 结果                                                          |
| --------------------------------- | ------------------------------------------------------------- |
| 直接导入 ai-engine 非 facade 路径 | `AiEngineConstraintModule` — 模块导入，合理                   |
| tool handlers 导入路径            | 4 处使用 `facade/ai-engine.facade` 子路径（风格问题，非违规） |
| LLM 硬编码                        | 0 处                                                          |
| console.log                       | 0 处                                                          |

### 10.2 特别关注

`mcp-server.module.ts` 中直接导入 `AiEngineConstraintModule`:

```typescript
import { AiEngineConstraintModule } from "../ai-engine/ai-engine-constraint.module";
```

这是 NestJS `@Module.imports[]` 中的模块级导入，属于合法的依赖注入配置，不违反 Facade 规则（Facade 规则约束的是 `import { SomeService }` 类型的符号导入，而非模块注册）。

---

## 十一、架构债务优先级矩阵

| 优先级 | 类型            | 描述                                                               | 影响范围          | 修复成本         | 建议时机 |
| ------ | --------------- | ------------------------------------------------------------------ | ----------------- | ---------------- | -------- |
| P0     | —               | 无 P0 问题                                                         | —                 | —                | —        |
| P1     | LLM 直连        | Perplexity 直连 2 处 + Anthropic key verify 2 处                   | ai-engine/llm     | 低               | 本迭代   |
| P2     | ESLint 覆盖缺口 | 5 个新域未被 no-restricted-imports 覆盖                            | 全局防御层        | 极低（改配置）   | 本周     |
| P3     | 风格统一        | 14 处 facade 子路径导入（`facade/ai-engine.facade` 而非 `facade`） | ai-app/mcp-server | 极低（批量 sed） | 下次迭代 |
| P3     | any 类型清理    | `modelConfig: any`, `artifact?: any` 等高优先级 4 处               | ai-app/image      | 低-中            | 下次迭代 |
| P4     | any 类型清理    | 剩余约 20 处 any                                                   | 分散              | 低               | 长期     |

---

## 十二、行动项清单

### 必须处理（本迭代）

- [ ] **[P1]** 修复 Perplexity 直连: `ai-engine/llm/services/` 相关文件改用 AiChatService
- [ ] **[P1]** 修复 Anthropic key verify 直调: 同上

### 计划处理（本周内）

- [ ] **[P2]** 更新 `backend/.eslintrc.js` 的 `no-restricted-imports`，用新路径替换失效旧规则:
  - `**/ai-engine/knowledge/**` 替代 `**/ai-engine/rag/**`
  - `**/ai-engine/infra/**` 替代 `**/ai-engine/realtime/**` 等
  - `**/ai-engine/content/**` 替代 `**/ai-engine/content-analysis/**` 等
  - 新增 `**/ai-engine/safety/**`
  - 新增 `**/ai-engine/api/**`

### 建议处理（下次迭代）

- [ ] **[P3]** 统一 `facade/ai-engine.facade` 子路径到 `facade`（14 个文件，脚本即可）
- [ ] **[P3]** 修复高优先级 any 类型: `image/generation/image-generation.service.ts`, `image/agents/image-designer.agent.ts`

### 长期改进

- [ ] 建立月度架构审计机制（目前约 2 周一次，建议固化为 CI 任务）
- [ ] 考虑将 ESLint no-restricted-imports 更新纳入架构重构后的 checklist

---

## 十三、趋势分析

| 版本                | 分数       | 主要变化                        |
| ------------------- | ---------- | ------------------------------- |
| v1 (2026-02-24)     | 83/100     | 基准                            |
| v2 (2026-02-24)     | 85/100     | Facade 违规修复                 |
| v3 (2026-02-25)     | 87/100     | LLM 硬编码修复                  |
| v4 (2026-02-25)     | 89/100     | 大规模重构完成，ESLint 防御削弱 |
| **v5 (2026-02-25)** | **90/100** | setTimeout .unref() 修复确认    |

**趋势**: 持续改善。当前最大未解决债务为 ESLint 规则失效（P2，修复成本极低）。

---

_下次建议审计时间: 2026-03-25（距今约 1 个月）_
_报告生成工具: Arch Auditor Agent v1.0 (claude-sonnet-4-6)_
_文件位置: `docs/audits/2026-02-25_arch-audit-v5.md`_
