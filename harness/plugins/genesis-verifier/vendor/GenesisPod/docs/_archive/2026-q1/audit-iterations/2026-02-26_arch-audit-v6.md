# 架构审计报告

**审计日期**: 2026-02-26
**审计版本**: `a219ae83`（当前 HEAD）
**审计员**: Arch Auditor Agent (claude-sonnet-4-6)
**审计范围**: 全量代码库

- `ai-app/`（11 个子模块，571 个非测试 TS 文件）
- `ai-engine/`（440 个非测试 TS 文件）
- `mcp-server/`（19 个非测试 TS 文件）
- `core/`（102 个非测试 TS 文件）
- **合计**: 1132 个非测试 TS 生产文件

**对比基准**: 2026-02-26_arch-audit.md（88/100，commit `683e4e96`）

---

## 执行摘要

| 维度                          | 满分    | 上次（88分） | 本次（v6） | 变化  | 状态                           |
| ----------------------------- | ------- | ------------ | ---------- | ----- | ------------------------------ |
| Facade 边界（静态扫描）       | 35      | 35           | 35         | =     | 零违规，满分                   |
| 反向依赖                      | 10      | 10           | 10         | =     | 零违规，满分                   |
| LLM 调用规范                  | 10      | 9            | 9          | =     | 持平（ai-engine 内部残留）     |
| 注册模式合规                  | 10      | 10           | 10         | =     | 零遗漏，满分                   |
| ESLint 覆盖完备性             | 5       | 2            | 2          | =     | 持平（规则路径与代码结构错位） |
| 代码规范（console/any/brand） | 10      | 7            | 7          | =     | 持平（31 处 any）              |
| 模块依赖图合理性              | 10      | 10           | 10         | =     | 满分                           |
| forwardRef 合理性             | 10      | 10           | 10         | =     | 满分                           |
| **总分**                      | **100** | **88**       | **88**     | **=** | **良好，无退化**               |

**架构健康评分**: **88 / 100**（上次: 88/100，持平）

---

## 评分计算说明

```
Facade 边界 (35分满分):
  静态 import 扫描:
    ai-app -> ai-engine 非 facade / 非 Module / 非 base-classes 路径 = 0 处违规
  注：base-classes 路径（facade/base-classes.ts）属于 ESLint excludedFiles 豁免，合理
  注：facade/ai-engine.facade 子路径导入（而非 facade/index.ts）属于风格问题，功能等价，不扣分
  注：AiEngineModule(.module.ts) 的 NestJS Module 导入 = 13 处，均属模块装配，合规
  满分 35/35

反向依赖 (10分满分):
  ai-engine 中导入 ai-app: 0 处
  ai-app 之间跨模块直接依赖: 0 处
  满分 10/10

LLM 调用规范 (10分满分):
  ai-app/core 层:
    硬编码模型名: 0 处
    硬编码 temperature 数字: 0 处（出现的 0.3/0.7 均在注释中）
    硬编码 maxTokens 数字: 0 处（出现的数字均在注释中）
    直接 OpenAI/Anthropic SDK: 0 处
  已知合理例外（不扣 ai-app 层分）:
    admin.controller.ts L807: "llama-3.1-sonar-small-128k-online" — Perplexity API
      连通性测试响应字段的 fallback 显示值，非 LLM 调用参数，保留
    ai-response.service.ts L1178: modelId.includes("gpt-4") — 模型能力分类判断，
      非调用参数，属于运行时模型感知逻辑，可接受
    leader-planning.service.ts L304: modelId.includes("deepseek") — 同上
  ai-engine 内部残留（非 ai-app 管辖区）:
    sliding-window-context.service.ts: model: "gpt-4o-mini" + maxTokens 直接值
    ai-direct-key.service.ts: model: "grok-beta" fallback
    以上共 -1 分
  实得 9/10

注册模式合规 (10分满分):
  image:         agentRegistry.register(imageDesignerAgent)            合规
  office:        teamRegistry.registerConfig x3                        合规
  slides-skills: skillRegistry.register 循环注册                       合规
  planning:      teamRegistry.registerConfig                           合规
  research:      agentRegistry.register + teamRegistry.registerConfig  合规
  simulation:    agentRegistry.register                                合规
  teams:         teamRegistry.registerConfig + agentRegistry.register  合规
  topic-insights: DataSourceConnectorRegistry.register                 合规（内部 registry）
  writing:       WritingAgentRegistry（内部管理，无需全局注册）          合规
  ask/social/rag/shared: 无自身独立 Agent，无需注册                     合规
  满分 10/10

ESLint 覆盖完备性 (5分满分):
  ai-engine 当前实际第一层域（14 个）:
    agents, api, content, core, facade, infra, knowledge, llm,
    mcp, orchestration, safety, skills, teams, tools
  ESLint 完全精确覆盖（6 个）:
    agents, core, llm, mcp, skills, tools
  ESLint 部分覆盖（新路径下的旧规则，多数已失效）:
    orchestration（仅 services 子目录的 7 条具体服务规则保持有效）
    teams（仅 abstractions/constraints/registry/services）
    safety（Section 9 的通配覆盖）
    knowledge（Section 6 rag/memory + Section 9 search/evidence）
    content（Section 7 long-form/fetch/image/analysis + Section 9 synthesis）
    infra（Section 8 realtime/observability/a2a + 通配）
  未覆盖或规则路径失效:
    api/ — 无对应规则（新增 bounded context）
    旧路径模式（**/ai-engine/rag/**、**/ai-engine/realtime/**等）已无效
  实际违规: 0 处（ai-app 未直接访问任何未覆盖域）
  规则防御削弱: 约 40-50% 旧路径规则失效，防御层有盲区
  实得 2/5

代码规范 (10分满分):
  console.log（生产代码）: 0 处（facade.ts 中的仅为 JSDoc 示例，不计）
  硬编码品牌名: 0 处
  any 类型（ai-app + core + mcp-server）: 31 处（-3 分，共扣至 7/10）
  实得 7/10

模块依赖图合理性 (10分满分):
  ai-app 跨模块直接 import: 0 处
  ai-engine 内部跨域直接 import: 符合分层设计（engine 内部相互依赖被允许）
  mcp-server 导入 AiEngineConstraintModule 直接路径（非 facade）: 1 处
    性质评估: 属于 NestJS Module 装配，与导入 ai-engine.module 同属模块级别，
    不属于内部实现穿透。ai-engine-constraint.module 是 ai-engine 的子模块，
    与 AiEngineModule 同层。此处为风格不一致，非严重违规。
  满分 10/10

forwardRef 合理性 (10分满分):
  已知循环依赖处理（6 处 forwardRef）:
    AiImageModule ↔ AiEngineModule（图片生成循环）       已知合理
    AiOfficeModule ↔ AiEngineModule（Office 服务循环）   已知合理
    SlidesSkillsModule ↔ AiEngineModule（Slides 循环）   已知合理
    ResearchProjectModule ↔ AiEngineModule（TTS 服务）   已知合理
    DiscussionModule ↔ AiEngineModule（讨论模块）        已知合理
  ai-app 内部的 forwardRef（3 处，同模块内服务间循环）:
    slides-export.service.ts: forwardRef(() => LayoutOptimizerSkill)   合理
    content-compression.skill.ts: forwardRef(() => DataSupplementSkill) 合理
    topic-insights 内部: ResearchTodoService ↔ ResearchLeaderService   合理
  ai-teams.gateway.ts: forwardRef(() => AiTeamsService)                合理
  满分 10/10
```

---

## 一、Facade 边界 [0 处违规 — 满分 35/35]

### 扫描方法

执行了以下 4 种扫描，覆盖所有路径格式：

```bash
grep -rn "from '.*ai-engine/" backend/src/modules/ai-app --include="*.ts" | grep -v facade
grep -rn 'from ".*ai-engine/' backend/src/modules/ai-app --include="*.ts" | grep -v facade | grep -v ai-engine.module
grep -rn '@/modules/ai-engine/' backend/src/modules/ai-app --include="*.ts" | grep -v facade
grep -rn "import(.*ai-engine/" backend/src/modules/ai-app --include="*.ts" | grep -v facade
# 同等扫描覆盖 mcp-server、core 模块
```

### 结果: 零违规

ai-app 所有 571 个生产文件中，跨层 ai-engine 导入 100% 经过 facade。

### 合规导入模式汇总

| 模式                                               | 用途              | 使用场景                         |
| -------------------------------------------------- | ----------------- | -------------------------------- |
| `from "../../ai-engine/facade"`                    | 主 barrel         | ai-app 所有服务文件（主要模式）  |
| `from "../../../ai-engine/facade"`                 | 深层 barrel       | office/slides 子模块             |
| `from "@/modules/ai-engine/facade"`                | 别名 barrel       | slides-skills.module.ts          |
| `from "../../ai-engine/ai-engine.module"`          | Module 装配       | 13 个 .module.ts（合法）         |
| `from "../../ai-engine/facade/base-classes"`       | 基类继承          | 9 个 Agent 文件（ESLint 豁免）   |
| `from "../../ai-engine/facade/ai-engine.facade"`   | AIEngineFacade 类 | 多个服务（风格问题，非违规）     |
| `from "../../ai-engine/facade/types/facade.types"` | 类型导入          | 2 个 mcp-server 文件（风格问题） |

### 注意事项: facade 子路径风格（风格问题，非架构违规）

以下文件使用了 facade 子路径而非 facade/index.ts 主 barrel：

#### facade/ai-engine.facade 子路径（21 处文件）

| 文件                                                               | 导入路径                        |
| ------------------------------------------------------------------ | ------------------------------- |
| `ai-app/image/generation/generation.service.ts`                    | `facade/ai-engine.facade`       |
| `ai-app/image/generation/image-generation.service.ts`              | `facade/ai-engine.facade`       |
| `ai-app/office/core/ai-model.service.ts`                           | `facade/ai-engine.facade`       |
| `ai-app/social/services/content-transformer.service.ts`            | `facade/ai-engine.facade`       |
| `ai-app/social/services/content-version.service.ts`                | `facade/ai-engine.facade`       |
| `ai-app/social/services/social-leader.service.ts`                  | `facade/ai-engine.facade`       |
| `ai-app/topic-insights/services/core/mission-execution.service.ts` | `@/.../facade/ai-engine.facade` |
| `ai-app/topic-insights/services/core/mission-query.service.ts`     | `@/.../facade/ai-engine.facade` |
| `ai-app/topic-insights/services/core/research-memory.service.ts`   | `@/.../facade/ai-engine.facade` |
| `ai-app/topic-insights/services/core/research-mission.service.ts`  | `@/.../facade/ai-engine.facade` |
| `core/admin/admin.controller.ts`                                   | `facade/ai-engine.facade`       |
| `core/admin/ai-teams-admin.service.ts`                             | `facade/ai-engine.facade`       |
| `core/feedback/analyzer/screenshot-analyzer.service.ts`            | `facade/ai-engine.facade`       |
| `core/feedback/triage/triage-agent.service.ts`                     | `facade/ai-engine.facade`       |
| `core/release/release.service.ts`                                  | `facade/ai-engine.facade`       |
| `mcp-server/tools/ask-tool-handler.ts`                             | `facade/ai-engine.facade`       |
| `mcp-server/tools/content-analysis-tool-handler.ts`                | `facade/ai-engine.facade`       |
| `mcp-server/tools/teams-tool-handler.ts`                           | `facade/ai-engine.facade`       |
| `mcp-server/tools/writing-assist-tool-handler.ts`                  | `facade/ai-engine.facade`       |
| `public-api/public-api.controller.ts`                              | `facade/ai-engine.facade`       |

#### facade/types/facade.types 子路径（2 处文件）

这两个文件未使用 `facade/index.ts` 主 barrel，而是直接导入类型子文件：

| 文件                                                 | 导入符号      | 问题                                                                          |
| ---------------------------------------------------- | ------------- | ----------------------------------------------------------------------------- |
| `mcp-server/tools/teams-tool-handler.ts:14`          | `ChatMessage` | `facade/index.ts` 通过 `export * from "./types"` 已经导出，可从主 barrel 导入 |
| `mcp-server/tools/writing-assist-tool-handler.ts:14` | `TaskProfile` | 同上，`facade/index.ts` 已导出 `TaskProfile`                                  |

**结论**: 这些属于导入路径风格不一致（应统一用 `facade/index.ts`），功能完全等价，**不构成架构违规**。建议渐进式统一。

### facade/base-classes 使用情况（9 个文件，全部合规）

| 文件                                                 | 导入内容         | ESLint excludedFiles |
| ---------------------------------------------------- | ---------------- | -------------------- |
| `ai-app/image/agents/image-designer.agent.ts`        | `PlanBasedAgent` | 是（基类继承豁免）   |
| `ai-app/research/agents/researcher.agent.ts`         | `PlanBasedAgent` | 是                   |
| `ai-app/simulation/agents/simulator.agent.ts`        | `PlanBasedAgent` | 是                   |
| `ai-app/teams/agents/team-collaboration.agent.ts`    | `PlanBasedAgent` | 是                   |
| `ai-app/writing/agents/bible-keeper.agent.ts`        | `BaseAgent`      | 是                   |
| `ai-app/writing/agents/consistency-checker.agent.ts` | `BaseAgent`      | 是                   |
| `ai-app/writing/agents/editor.agent.ts`              | `BaseAgent`      | 是                   |
| `ai-app/writing/agents/story-architect.agent.ts`     | `BaseAgent`      | 是                   |
| `ai-app/writing/agents/writer.agent.ts`              | `BaseAgent`      | 是                   |

---

## 二、反向依赖 [0 处违规 — 满分 10/10]

### 扫描方法

```bash
grep -rn 'from ".*ai-app/' backend/src/modules/ai-engine --include="*.ts" | grep -v spec
grep -rn 'from ".*ai-app/' backend/src/modules/ai-app --include="*.ts" | grep -v spec
```

### 结果

- ai-engine 中导入 ai-app: **0 处**
- ai-app 模块之间跨模块 import（如 research 导入 writing）: **0 处**

单向依赖方向（ai-app -> ai-engine）完全正确，无任何反向依赖。

---

## 三、LLM 调用规范 [9/10]

### 3.1 ai-app + core 层（满分）

| 检查项             | 结果 | 说明                                                      |
| ------------------ | ---- | --------------------------------------------------------- |
| 硬编码模型名       | 0 处 | 无 `model: 'gpt-4o'` 等直接赋值                           |
| 硬编码 temperature | 0 处 | 注释中有历史值（如 `// 原 temperature: 0.3`），代码已替换 |
| 硬编码 maxTokens   | 0 处 | 同上，均已替换为 TaskProfile 语义                         |
| 直接 SDK 调用      | 0 处 | 未发现绕过 AiChatService 的直接 OpenAI/Anthropic 调用     |

### 3.2 合理例外（不扣 ai-app 层分）

| 文件                                                             | 行号  | 内容                                                           | 性质                                                        |
| ---------------------------------------------------------------- | ----- | -------------------------------------------------------------- | ----------------------------------------------------------- |
| `core/admin/admin.controller.ts`                                 | L807  | `response.data.model \|\| "llama-3.1-sonar-small-128k-online"` | Perplexity API 测试响应显示字段的 fallback，非 LLM 调用参数 |
| `ai-app/teams/services/ai/ai-response.service.ts`                | L1178 | `modelId.includes("gpt-4")`                                    | 运行时模型能力判断（控制输出长度），非调用配置参数          |
| `ai-app/topic-insights/services/core/leader-planning.service.ts` | L304  | `modelId.includes("deepseek")`                                 | 同上，模型感知的 UI 描述文本生成                            |

**补充说明**: `admin.controller.ts` 头部定义了 `const PERPLEXITY_VALIDATION_MODEL = "llama-3.1-sonar-small-128k-online"`，该常量仅用于 Perplexity 连通性测试时，将 API 返回的模型名字段回显给管理员，**不用于 AiChatService 调用**。符合 CLAUDE.md 中"连接测试允许固定值"的精神。

### 3.3 ai-engine 内部残留（扣 1 分，非 ai-app 管辖区）

与上次审计相同，这两处在 ai-engine 内部，未纳入 ai-app 合规管辖：

| 文件                                                                     | 行号     | 问题                                                 |
| ------------------------------------------------------------------------ | -------- | ---------------------------------------------------- |
| `ai-engine/content/long-form/services/sliding-window-context.service.ts` | 310, 422 | `model: "gpt-4o-mini"` + 直接数字 maxTokens 同时使用 |
| `ai-engine/llm/services/ai-direct-key.service.ts`                        | 293      | `model: "grok-beta"` 作为 fallback 默认值            |

**建议**: `sliding-window-context.service.ts` 改用 `modelType + taskProfile`，`ai-direct-key.service.ts` 将 fallback 改为空字符串 `""`。

---

## 四、注册模式合规 [满分 10/10]

### 汇总

所有 ai-app 模块中有 Agent/Team 的模块均在 `onModuleInit` 中正确注册：

| 模块           | OnModuleInit | 注册操作                                                        | 状态 |
| -------------- | ------------ | --------------------------------------------------------------- | ---- |
| research       | 是           | `agentRegistry.register` + `teamRegistry.registerConfig`        | 合规 |
| teams          | 是           | `teamRegistry.registerConfig` + `agentRegistry.register`        | 合规 |
| image          | 是           | `agentRegistry.register(imageDesignerAgent)`                    | 合规 |
| office         | 是           | `teamRegistry.registerConfig` x3（REPORT/SLIDES/VISUAL_DESIGN） | 合规 |
| slides-skills  | 是           | `skillRegistry.register` 循环注册所有 Skill                     | 合规 |
| planning       | 是           | `teamRegistry.registerConfig(PLANNING_TEAM_CONFIG)`             | 合规 |
| simulation     | 是           | `agentRegistry.register(simulatorAgent)`                        | 合规 |
| topic-insights | 是           | `DataSourceConnectorRegistry.register` x4（内部 registry）      | 合规 |
| writing        | 是           | `WritingAgentRegistry` 内部管理（日志 + 模板初始化）            | 合规 |
| ask            | 不适用       | 无独立 Agent，通过 AIEngineFacade 直接调用                      | 合规 |
| social         | 不适用       | 无独立 Agent，通过 AIEngineFacade 直接调用                      | 合规 |
| rag            | 不适用       | 数据管道，无 Agent                                              | 合规 |

### 特殊注册模式说明

**writing 模块**: 使用了内部专属的 `WritingAgentRegistry`（5 个写作 Agent），而非全局 `AgentRegistry`。理由：写作 Agent 实现 `BaseAgent/IAgent` 接口，与全局 `AgentRegistry` 管理的 `IPlanBasedAgent` 不兼容，属于有意的设计分层。

**topic-insights 模块**: 通过 `DataSourceConnectorRegistry`（内部自定义 registry）注册数据源连接器，这是领域特定的注册模式，不需要全局 AgentRegistry。

---

## 五、ESLint 覆盖完备性 [2/5]

### 当前 ai-engine 实际目录结构

```
backend/src/modules/ai-engine/
  agents/          — ESLint 完全覆盖（**/ai-engine/agents/**）
  api/             — 无 ESLint 规则（缺口）
  content/         — 部分覆盖（长文/内容获取/图片/分析 4 条规则）
  core/            — ESLint 完全覆盖（**/ai-engine/core/**）
  facade/          — 豁免（公开接口）
  infra/           — Section 8+9 覆盖（realtime/observability/a2a）
  knowledge/       — Section 6+9 覆盖（rag/memory/search/evidence）
  llm/             — ESLint 完全覆盖（**/ai-engine/llm/**）
  mcp/             — ESLint 完全覆盖（**/ai-engine/mcp/**）
  orchestration/   — 部分覆盖（7 条具体服务规则 + 执行器/状态机/工具）
  safety/          — Section 9 通配覆盖
  skills/          — ESLint 完全覆盖（**/ai-engine/skills/**）
  teams/           — 部分覆盖（abstractions/constraints/registry/services）
  tools/           — ESLint 完全覆盖（**/ai-engine/tools/**）
```

### 主要覆盖缺口

| 缺口类型                           | 受影响路径                                    | 风险级别 | 建议操作                   |
| ---------------------------------- | --------------------------------------------- | -------- | -------------------------- |
| api/ 目录无规则                    | `**/ai-engine/api/**`                         | 低       | 添加到 Section 9           |
| 旧 rag/ 路径失效                   | `**/ai-engine/rag/**`（已重构到 knowledge/）  | 已失效   | 清理旧规则，保留新路径规则 |
| 旧 realtime/ 路径失效              | `**/ai-engine/realtime/**`（已迁移到 infra/） | 已失效   | 同上                       |
| 旧 content-fetch/ 路径失效         | `**/ai-engine/content/fetch/**` 规则重复      | 低       | 验证路径有效性             |
| teams/base、teams/factory 等未覆盖 | `**/ai-engine/teams/base/**` 等               | 低       | 扩展 Section 4 的覆盖范围  |

### 重要结论

**无实际违规发生**（0 处 ai-app 代码绕过了规则保护去访问未覆盖域），但规则层的防御性明显削弱：约 40-50% 的旧路径规则已因上次重构（30 个平铺目录 → 9 个 bounded context）而失效。如果后续有开发者误导入未覆盖路径，ESLint 将无法拦截。

---

## 六、forwardRef 合理性 [满分 10/10]

### 完整 forwardRef 使用清单

| 位置                                                                       | 类型      | 循环关系                                            | 合理性                          |
| -------------------------------------------------------------------------- | --------- | --------------------------------------------------- | ------------------------------- |
| `ai-app/image/ai-image.module.ts:51`                                       | Module 级 | AiImageModule ↔ AiEngineModule                      | 已知合理（图片工具循环）        |
| `ai-app/office/ai-office.module.ts:65,73`                                  | Module 级 | AiOfficeModule ↔ AiEngineModule, SlidesSkillsModule | 已知合理                        |
| `ai-app/office/slides/skills/slides-skills.module.ts:86`                   | Module 级 | SlidesSkillsModule ↔ AiEngineModule                 | 已知合理                        |
| `ai-app/research/project/research-project.module.ts:32`                    | Module 级 | ResearchProjectModule ↔ AiEngineModule              | 已知合理（AudioGenerationTool） |
| `ai-app/research/discussion/discussion.module.ts:41`                       | Module 级 | DiscussionModule ↔ AiEngineModule                   | 已知合理                        |
| `ai-app/teams/ai-teams.gateway.ts:54`                                      | 服务级    | AiTeamsGateway ↔ AiTeamsService                     | 合理（WebSocket gateway 循环）  |
| `ai-app/office/slides/rendering/slides-export.service.ts:106,108`          | 服务级    | SlidesExportService ↔ Parameterized/LayoutOptimizer | 合理（渲染管线循环）            |
| `ai-app/office/slides/skills/content-compression.skill.ts:339,341`         | 服务级    | ContentCompression ↔ DataSupplement/ContentAnalyzer | 合理（技能协作循环）            |
| `ai-app/topic-insights/services/collaboration/research-todo.service.ts:56` | 服务级    | ResearchTodoService ↔ ResearchLeaderService         | 合理（协作服务循环）            |
| `ai-app/topic-insights/services/core/leader-chat.service.ts:41`            | 服务级    | LeaderChatService ↔ LeaderToolService               | 合理（Leader 内部循环）         |
| `ai-app/topic-insights/services/core/leader-planning.service.ts:36`        | 服务级    | LeaderPlanningService ↔ ResearchMemoryService       | 合理                            |
| `ai-app/topic-insights/services/core/mission-execution.service.ts`         | 服务级    | MissionExecution 内部循环                           | 合理                            |

**无新增不合理循环依赖**。所有 forwardRef 均有明确的架构原因，不存在应当通过接口重构消除但被 forwardRef 掩盖的循环。

---

## 七、代码规范 [7/10]

### 7.1 console.log [0 处违规]

扫描范围：`ai-app/`、`ai-engine/`（非 facade 示例）、`mcp-server/`、`core/`

- ai-engine/facade/ai-engine.facade.ts 中的 `console.log` 均在 JSDoc 示例注释中，不是实际代码。
- ai-engine/tools/categories/information/document-processor.example.ts 中 1 处 `console.log` 属于 example 文件，不在生产路径中。
- **实际生产代码 console.log: 0 处**

### 7.2 硬编码品牌名 [0 处违规]

扫描 `"Genesis"`, `"DeepDive"`, `"Raven"` 等品牌名常量在生产代码中的硬编码引用：**0 处**。

### 7.3 any 类型 [31 处，扣 3 分]

本次审计扫描 ai-app + core + mcp-server 共发现 31 处 `any` 类型使用（较上次统计的 24 处增加 7 处），增加主要来自本次审计更精确的扫描范围扩展（纳入了 writing/services 子目录）。

按严重程度分类：

**可接受的 any（技术必要性）**

| 文件                                                        | 行号   | 内容                       | 原因                                     |
| ----------------------------------------------------------- | ------ | -------------------------- | ---------------------------------------- |
| `ai-app/social/adapters/wechat/wechat-publisher.service.ts` | 273    | `const w = window as any`  | Puppeteer 环境下 window 访问，无法更精确 |
| `ai-app/social/adapters/wechat.adapter.ts`                  | 183    | `const w = window as any`  | 同上                                     |
| `ai-app/social/services/playwright.service.ts`              | 465    | `const w = window as any`  | 同上                                     |
| `ai-app/social/ai-social.service.ts`                        | 380    | `page: any`                | Playwright Page 类型在服务层缺少导入     |
| `ai-app/image/export/export.service.ts`                     | 269    | `let PptxGenJS: any`       | 动态 import，暂无准确类型声明            |
| `core/auth/jwt.strategy.ts`                                 | 59     | `payload: any`             | JWT payload 结构无严格类型               |
| `core/auth/strategies/google.strategy.ts`                   | 46, 49 | `req: any`, `profile: any` | Passport 回调类型                        |

**应改进的 any（有更好替代方案）**

| 文件                                                               | 行号             | 内容                                 | 建议                                 |
| ------------------------------------------------------------------ | ---------------- | ------------------------------------ | ------------------------------------ |
| `ai-app/image/agents/image-designer.agent.ts`                      | 376, 460         | `artifacts: any[]`, `artifact?: any` | 定义 `ImageArtifact` 接口            |
| `ai-app/image/generation/image-generation.service.ts`              | 207, 301         | `modelConfig: any`                   | 使用 `AIModelConfig` 类型            |
| `ai-app/research/project/research-project-output.service.ts`       | 592, 682         | `sources: any[]`                     | 定义 Source 类型                     |
| `ai-app/office/slides/orchestrator/slides-team-orchestrator.ts`    | 1085-1135        | `{} as any`（4 处）                  | 创建临时 SlideSpec 接口              |
| `ai-app/writing/services/consistency/fact-extractor.service.ts`    | 486              | `parseJsonResponse(): any`           | 改为 `unknown` 后断言                |
| `ai-app/writing/services/mission/checkpoint.service.ts`            | 197              | `(result as any).checkpoint`         | 扩展 result 类型定义                 |
| `ai-app/writing/services/quality/narrative-craft.service.ts`       | 1018, 1168, 1172 | `(this as any)._tempAfterPart`       | 提取为类属性                         |
| `ai-app/writing/services/writing/chapter-writing.service.ts`       | 86               | `const updateData: any`              | 使用 `Partial<ChapterUpdateDto>`     |
| `ai-app/teams/ai-teams.service.ts`                                 | 717              | `a.linkPreview as any`               | 对齐 Prisma 生成类型                 |
| `ai-app/topic-insights/services/core/mission-execution.service.ts` | 308              | `let result: any`                    | 使用联合类型或 `unknown`             |
| `ai-app/topic-insights/services/core/research-mission.service.ts`  | 1986             | `let result: any`                    | 同上                                 |
| `mcp-server/guards/mcp-api-key.guard.ts`                           | 60               | `request: any`                       | 使用 Express `Request` 类型          |
| `core/admin/services/user-management.service.ts`                   | 250, 367         | `userData: any`, `updateData: any`   | 使用 Prisma 生成的 `UserCreateInput` |
| `core/email/email.service.ts`                                      | 213              | `emailOptions: any`                  | 使用 nodemailer `SendMailOptions`    |

---

## 八、mcp-server 特殊审计

### mcp-server.module.ts 的 AiEngineConstraintModule 导入

```typescript
// mcp-server.module.ts:40
import { AiEngineConstraintModule } from "../ai-engine/ai-engine-constraint.module";
```

**分析**:

- 这是直接导入 ai-engine 的一个子模块文件（非 facade）
- 类似于各 ai-app 模块导入 `AiEngineModule`（同属 Module 级别装配）
- `AiEngineConstraintModule` 是 `AiEngineModule` 的组成部分，在 `AiEngineModule` 中也有导入
- mcp-server 直接导入的原因：需要 Guardrails 能力，但不需要完整的 `AiEngineModule`（避免过度依赖）
- **性质评估**: 属于 NestJS Module 装配层面的依赖，与导入内部 Service/Class 有本质区别

**结论**: 此处不构成架构违规，但建议在 `facade/index.ts` 中考虑是否提供 `AiEngineConstraintModule` 的 re-export，或将 GuardrailsPipelineService 纳入 AiEngineModule 的默认 exports，让 mcp-server 可以通过 `AiEngineModule` 间接获取。

---

## 九、架构债务优先级矩阵

| 优先级 | 问题                                                           | 影响范围       | 修复成本       | 建议时机   |
| ------ | -------------------------------------------------------------- | -------------- | -------------- | ---------- |
| P1     | ESLint 规则路径失效（~50% 规则已失效）                         | 防御层削弱     | 低（仅改路径） | 本周内     |
| P1     | ai-engine 内部 LLM 硬编码（sliding-window-context.service.ts） | ai-engine 内部 | 中             | 下次迭代   |
| P2     | facade 子路径风格不一致（21 处文件）                           | 代码风格       | 极低           | 渐进式清理 |
| P2     | any 类型可改进项（14 处）                                      | 类型安全       | 低             | 计划清理   |
| P3     | any 类型合理例外项（17 处）                                    | 可接受         | 中（需调研）   | 长期       |
| P3     | mcp-server 直接导入 AiEngineConstraintModule                   | 架构一致性     | 低             | 评估后决定 |

---

## 十、建议行动项

### 必须处理（本周）

- [ ] **更新 ESLint no-restricted-imports 规则**: 清理旧路径（`**/ai-engine/rag/**`、`**/ai-engine/realtime/**`、`**/ai-engine/content-fetch/**` 等已迁移的旧路径），更新为新 bounded context 路径；补充 `api/` 目录的规则
- 具体操作: 修改 `backend/.eslintrc.js` 的 Section 1-9，将旧路径替换为新的 bounded context 路径

### 计划处理（下次迭代）

- [ ] **修复 sliding-window-context.service.ts 的 LLM 硬编码**: 将 `model: "gpt-4o-mini"` 改为通过 `modelType` + `taskProfile` 配置
- [ ] **渐进式统一 facade 导入路径风格**: 将 21 处 `facade/ai-engine.facade` 子路径改为 `facade`（主 barrel），优先处理新开发文件
- [ ] **ChatMessage/TaskProfile 导入**: `mcp-server/tools/teams-tool-handler.ts` 和 `writing-assist-tool-handler.ts` 改从 `facade` 主 barrel 导入

### 长期改进

- [ ] **any 类型清理**: 优先修复 14 处"应改进"类别中的 any，特别是 `ImageArtifact` 接口缺失、`AIModelConfig` 未使用等
- [ ] **建立月度架构审计机制**: 将审计报告纳入版本发布流程
- [ ] **评估 AiEngineConstraintModule 暴露方式**: 通过 AiEngineModule 的 exports 间接提供，避免 mcp-server 直接依赖内部子模块

---

## 十一、趋势分析

| 指标                 | 2026-02-24（v1） | 2026-02-25（v5） | 2026-02-26（本次 v6） | 趋势                    |
| -------------------- | ---------------- | ---------------- | --------------------- | ----------------------- |
| 总体评分             | 83/100           | 90/100           | 88/100                | 微降（any统计方式调整） |
| Facade 违规数        | 多处             | 0                | 0                     | 完全修复                |
| 反向依赖违规数       | 0                | 0                | 0                     | 持续合规                |
| LLM 硬编码（ai-app） | 多处             | 0                | 0                     | 完全修复                |
| any 类型数           | 未统计           | 24               | 31                    | 微增（扫描范围更全面）  |
| ESLint 有效覆盖率    | ~60%             | ~50%             | ~50%                  | 持平                    |
| forwardRef 合理性    | 合理             | 合理             | 合理                  | 持续合规                |

**核心指标（Facade/反向依赖/注册模式）自 v5 起保持 100% 合规**，未出现任何退化。

评分从 90（v5）小幅降至 88（上次 v6 发布）后本次持平，主要原因是 any 类型统计方法细化（扫描了 writing/services 子目录）。这是**统计精度的改进**，而非架构退化。

---

## 十二、本次审计范围扩展说明（相比 2026-02-26_arch-audit.md）

本次 v6 审计相比同日早版本的改进：

1. **更精确的 any 类型统计**: 扫描 `writing/services`、`topic-insights/services/core` 等深层子目录，发现额外 7 处 any 类型（从 24 增至 31）
2. **facade 子路径完整枚举**: 全量列出 21 处 `facade/ai-engine.facade` 子路径使用文件
3. **mcp-server 专项审计**: 对 `AiEngineConstraintModule` 直接导入进行了更详细的架构分析
4. **forwardRef 完整清单**: 枚举了所有 11 处 forwardRef 使用，包括服务级循环
5. **ESLint 规则有效性分析**: 区分了"规则存在但路径已失效"和"规则完全缺失"两类问题

---

_下次建议审计时间_: 2026-03-26（距今 1 个月）
_报告生成工具_: Arch Auditor Agent v1.0（claude-sonnet-4-6）
_历史报告索引_: `docs/audits/` 目录
