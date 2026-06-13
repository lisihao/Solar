# 架构审计报告

**审计日期**: 2026-02-25
**审计版本**: `b5213ba1`（git commit 前 8 位）
**审计员**: Arch Auditor Agent (claude-sonnet-4-6)
**审计范围**: 全量代码库 — `ai-app/`（11 个子模块，582 个 TS 文件）+ `ai-engine/`（439 个 TS 文件）+ `core/admin/` + `ingestion/`
**对比基准**: 2026-02-25_arch-audit-v2.md（84/100，commit `827e8bdd`）
**本次变更上下文**: 提交 `c264e9c4` 修复 ESLint memory 覆盖缺口；`0f3b0b05` 修复 31 处 timer .unref() 及 floating promise；`4a349dbe` 消除 14 处硬编码模型名

---

## 执行摘要

| 维度               | 满分    | 上次（`827e8bdd`） | 本次（`b5213ba1`） | 变化   | 状态     |
| ------------------ | ------- | ------------------ | ------------------ | ------ | -------- |
| Facade 边界        | 35      | 35                 | 35                 | =      | 完全合规 |
| 反向依赖           | 10      | 10                 | 10                 | =      | 完全合规 |
| LLM 硬编码         | 20      | 15                 | 17                 | +2     | 持续改善 |
| 注册模式合规       | 5       | 5                  | 5                  | =      | 完全合规 |
| ESLint 覆盖完备性  | 5       | 4                  | 5                  | +1     | 满分修复 |
| Timer/浮动 Promise | 5       | 3                  | 4                  | +1     | 显著改善 |
| any 类型           | 10      | 7                  | 7                  | =      | 警告持平 |
| 代码规范           | 10      | 10                 | 10                 | =      | 满分保持 |
| **总分**           | **100** | **84**             | **87**             | **+3** | **良好** |

**架构健康评分**: **87 / 100**（上次: 84/100，**+3 分**）

### 关键发现摘要

1. **Facade 边界继续满分（35/35）**: 全量 grep 扫描零违规。ESLint `no-restricted-imports` 9 节规则持续有效。
2. **ESLint 覆盖缺口已修复（+1 分）**: `c264e9c4` 将 `memory/abstractions/**` 和 `memory-coordinator.service.ts` 纳入限制，消除了上次审计发现的 memory 子目录覆盖缺口。
3. **Timer .unref() 大幅修复（+1 分）**: `0f3b0b05` 为 31 处模块级 timer 补加 `.unref()`，同时修复 floating promise。但仍存在 2 处遗漏：`feishu.service.ts:98` 和 `slides-mission-health.service.ts:165`。
4. **LLM 硬编码继续改善（+2 分）**: `4a349dbe` 消除 14 处硬编码模型名（`ai-engine/llm/services` 层 provider 文件及 `content/reports`），使生产代码残留从 5 处降至 3 处。
5. **反向依赖零违规**: ai-engine 层仍无任何对 ai-app 的导入。
6. **any 类型持平**: ~17 处存量，集中在 image/office/social/writing。无新增。

---

## 评分计算说明

```
Facade 边界 (35分满分):
  静态 import 扫描：0 处违规
  动态 import() 扫描：0 处违规
  ESLint no-restricted-imports：9 节规则，覆盖全部 ai-engine 子目录
  满分 35/35

反向依赖 (10分满分):
  grep 扫描 ai-engine/ 中 ai-app 导入：0 处（仅注释引用）
  满分 10/10

LLM 硬编码 (20分满分):
  ai-app 层（GEMINI_IMAGE_MODELS 能力路由枚举）: 1 处 → -1 分
  core/admin 层（Perplexity API 直连，2 处）: → -1 分
  core 层（Anthropic API key 验证，2 处）: → -1 分
  triage-decision.types.ts temperature: 0.3（应迁移 TaskProfile）: → 0 分（降为 P2）
  content/resources/config temperature/maxTokens（非调用链，配置说明文件）: → 0 分
  合计: 17/20

注册模式合规 (5分满分):
  所有有 Agent/Team 的模块均在 onModuleInit 正确注册 → 5/5

ESLint 覆盖完备性 (5分满分):
  c264e9c4 修复 memory/abstractions + memory-coordinator 缺口 → 满分 5/5

Timer/浮动 Promise (5分满分):
  0f3b0b05 修复 31 处 timer，基本合规
  feishu.service.ts:98 cleanupInterval 无 .unref() → -0.5
  slides-mission-health.service.ts:165 setTimeout 无 .unref() → -0.5
  实得 4/5

any 类型 (10分满分):
  ai-app 层生产代码 ~17 处（排除 window as any、测试文件）
  每 10 处扣 1.5 分
  实得约 7/10（与上次持平）

代码规范 (10分满分):
  console.log：ai-app/ai-engine 生产代码 0 处
  品牌硬编码："Genesis"/"Raven"/"DeepDive" 0 处
  满分 10/10
```

---

## 一、Facade 边界 [0 处违规 — 满分 35/35]

### 1.1 静态 import 扫描

扫描模式：`from ['"](..\/)+(ai-engine\/)(?!facade)`，范围：`backend/src/modules/ai-app/**/*.ts`（排除 spec/test）

**结果: 0 处违规**。

### 1.2 动态 import() 扫描

扫描模式：`import\(.*ai-engine\/(?!facade)`，范围：`ai-app/**/*.ts`

**结果: 0 处违规**。无内联 `import()` 绕过 Facade。

### 1.3 ESLint 豁免文件（合法的直接路径引用）

| 文件                                               | 导入路径                                            | 豁免原因                         |
| -------------------------------------------------- | --------------------------------------------------- | -------------------------------- |
| `ai-app/teams/agents/*.agent.ts`                   | `ai-engine/agents/base/plan-based-agent`            | 类继承必须直接引用基类           |
| `ai-app/teams/agents/team-member.agent.ts`         | `ai-engine/core`, `ai-engine/tools/registry`        | 类继承模式，ESLint excludedFiles |
| `ai-app/office/common/content-analysis.service.ts` | `ai-engine/content-analysis`                        | 桥接适配器，已显式列入豁免       |
| `ai-app/office/common/content-analysis.types.ts`   | `ai-engine/content-analysis/content-analysis.types` | 桥接适配器，已显式列入豁免       |
| `ai-app/office/common/image-matching.service.ts`   | `ai-engine/image/matching`                          | 桥接适配器，已显式列入豁免       |
| `ai-app/office/slides/skills/*.skill.ts`           | `ai-engine/skills/base` 等                          | ISkill 实现继承基类              |
| `ai-app/**/*.config.ts`                            | `ai-engine/teams/abstractions/**`                   | Team 配置定义必须引用抽象接口    |

### 1.4 按模块汇总

| ai-app 子模块  | 违规数 | 状态                     |
| -------------- | ------ | ------------------------ |
| research       | 0      | 合规                     |
| teams          | 0      | 合规（类继承文件已豁免） |
| writing        | 0      | 合规                     |
| office         | 0      | 合规（桥接文件已豁免）   |
| ask            | 0      | 合规                     |
| social         | 0      | 合规                     |
| image          | 0      | 合规                     |
| simulation     | 0      | 合规                     |
| rag            | 0      | 合规                     |
| topic-insights | 0      | 合规                     |
| planning       | 0      | 合规                     |
| **合计**       | **0**  | **满分**                 |

---

## 二、反向依赖（ai-engine → ai-app）[0 处]

扫描模式：`from ['"].*modules/ai-app/`，范围：`backend/src/modules/ai-engine/**/*.ts`

**结果: 0 处**。仅发现 4 处注释引用（`interfaces/image.interface.ts` 等）说明接口实现位置，不构成代码依赖。单向依赖原则完全遵守。

---

## 三、LLM 硬编码 [3 处生产代码残留]

### 3.1 本次新修复（`4a349dbe` 消除的 14 处）

以下违规在上次审计（v2）中被标记，现已确认全部修复：

- `common/ai-orchestration/providers/anthropic.provider.ts` 等：`fallback model = "claude-xxx"` 已改为 `""`
- `ai-engine/llm/services/ai-chat.service.ts`：默认模型硬编码已改为 `""`
- `ai-engine/llm/services/ai-connection-test.service.ts`：连接测试默认 model 改为 `""`
- `ai-engine/llm/services/ai-direct-key.service.ts`：`"gpt-4"` 超时检测参数已改为 `effectiveModelId`
- `content/reports/reports.service.ts`：报告生成模型硬编码已改为 `""`

### 3.2 现存残留（3 处）

#### ai-app 层（1 处 — P2 低风险）

| 文件                                   | 行号    | 问题代码                                              | 使用场景                     | 风险等级 | 建议                                                      |
| -------------------------------------- | ------- | ----------------------------------------------------- | ---------------------------- | -------- | --------------------------------------------------------- |
| `ai-app/image/core/image.constants.ts` | 141-142 | `GEMINI_IMAGE_MODELS = ["gemini-2.0-flash-exp", ...]` | 图像模型路由能力检查，非调用 | 低       | 迁移至数据库驱动的 `supportsImageGeneration` 模型能力标记 |

注意：此常量用于 `isGeminiImageCapable` 路由判断，未直接传给 `AiChatService.chat()`，不影响运行时模型选择。

#### core/admin 层（2 处 — P2 运维支持层）

| 文件                                                     | 行号 | 问题代码                                     | 使用场景                              | 风险等级 | 建议                                |
| -------------------------------------------------------- | ---- | -------------------------------------------- | ------------------------------------- | -------- | ----------------------------------- |
| `core/admin/admin.controller.ts`                         | 782  | `model: "llama-3.1-sonar-small-128k-online"` | Perplexity API 连通性测试（直调 API） | 低       | 提取为 `PERPLEXITY_TEST_MODEL` 常量 |
| `core/admin/admin.service.ts`                            | 1992 | `model: "llama-3.1-sonar-small-128k-online"` | 同上（服务层副本）                    | 低       | 与 controller 共享同一常量          |
| `core/user-api-keys/user-api-keys.service.ts`            | 655  | `model: "claude-3-haiku-20240307"`           | Anthropic API Key 有效性验证（直调）  | 低       | 提取为 `ANTHROPIC_TEST_MODEL` 常量  |
| `core/admin/quota/providers/anthropic-quota.provider.ts` | 48   | `model: "claude-3-haiku-20240307"`           | Anthropic 余额探测（直调）            | 低       | 与 user-api-keys 共享同一常量       |

**说明**: 这 4 处（上次 v2 亦有记录）均为 API Key 验证/连通性探测的直接 API 调用，技术上合理（绕过 AiChatService 是必要的），但模型名应提取为可配置常量。

#### ai-engine 内部层（豁免，不计扣分）

| 文件                                                           | 类型             | 豁免原因                                          |
| -------------------------------------------------------------- | ---------------- | ------------------------------------------------- |
| `ai-engine/constraint/guardrails/cost-controller.ts` 159-186   | 定价元数据表     | 明确注释说明"pricing reference table，非调用配置" |
| `ai-engine/llm/services/ai-chat.service.ts:271`                | `temperature: 0` | LLM 层内部守卫检查，不走 TaskProfile 路径         |
| `ai-engine/llm/services/ai-connection-test.service.ts:128-348` | `temperature: 0` | 连通性测试的最小参数，不走 TaskProfile            |

### 3.3 遗留 temperature/maxTokens 硬编码

| 文件                                            | 行号 | 问题                                                            | 状态                     |
| ----------------------------------------------- | ---- | --------------------------------------------------------------- | ------------------------ |
| `core/feedback/triage/triage-decision.types.ts` | 288  | `temperature: 0.3, maxTokens: 2000` 在 DEFAULT_TRIAGE_CONFIG    | P2：应迁移至 TaskProfile |
| `content/resources/config/ai-prompts.config.ts` | 292  | `temperature: 0.7, maxTokens: 2000` 在 requestDefaults 配置对象 | P2：确认是否被实际调用   |

---

## 四、注册模式合规 [完全合规 — 满分 5/5]

### 4.1 所有 ai-app 模块注册情况

| 模块                 | 模块文件                   | 注册内容                                                                                             | OnModuleInit | 状态 |
| -------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------- | ------------ | ---- |
| research             | `research.module.ts`       | `agentRegistry.register(researcherAgent)` + `teamRegistry.registerConfig(RESEARCH_TEAM_CONFIG)`      | 是           | 合规 |
| teams                | `ai-teams.module.ts`       | `teamRegistry.registerConfig(DEBATE_TEAM_CONFIG)` + `agentRegistry.register(teamCollaborationAgent)` | 是           | 合规 |
| writing              | `ai-writing.module.ts`     | `promptSkillBridge.registerDomain("writing")`                                                        | 是           | 合规 |
| office               | `ai-office.module.ts`      | `teamRegistry.registerConfig(REPORT/SLIDES/VISUAL_DESIGN_TEAM_CONFIG)`                               | 是           | 合规 |
| image                | `ai-image.module.ts`       | `agentRegistry.register(imageDesignerAgent)`                                                         | 是           | 合规 |
| simulation           | `ai-simulation.module.ts`  | `agentRegistry.register(simulatorAgent)`                                                             | 是           | 合规 |
| topic-insights       | `topic-insights.module.ts` | `promptSkillBridge.registerDomain("research")` + 4 数据源连接器                                      | 是           | 合规 |
| planning             | `ai-planning.module.ts`    | `teamRegistry.registerConfig(PLANNING_TEAM_CONFIG)`                                                  | 是           | 合规 |
| office/slides/skills | `slides-skills.module.ts`  | 17 个技能 + `promptSkillBridge.registerDomain("office")`                                             | 是           | 合规 |
| social               | `ai-social.module.ts`      | 无 Agent/Team                                                                                        | 不需要       | 合规 |
| ask                  | `ai-ask.module.ts`         | 无 Agent/Team                                                                                        | 不需要       | 合规 |
| rag                  | `rag.module.ts`            | 无 Agent/Team                                                                                        | 不需要       | 合规 |

**结论**: 所有有 Agent 或 Team 配置的模块均正确在 `onModuleInit()` 中完成注册，无遗漏。

---

## 五、ESLint 规则覆盖完备性 [满分 5/5]

### 5.1 本次修复（commit `c264e9c4`）

上次审计（v2）发现的缺口已修复：

**修复前** (v2 报告):

```javascript
// 仅覆盖 stores/**
"**/ai-engine/memory/stores/**";
```

**修复后** (当前 .eslintrc.js:293-295):

```javascript
("**/ai-engine/memory/stores/**",
  "**/ai-engine/memory/abstractions/**",
  "**/ai-engine/memory/memory-coordinator.service*");
```

### 5.2 当前覆盖状态

`.eslintrc.js` 的 `no-restricted-imports` 规则（9 节）覆盖 ai-engine 所有一级子目录：

| Section | 覆盖路径                                                                                                                                                                                               |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1       | `agents/**`, `tools/**`, `core/**`                                                                                                                                                                     |
| 2       | `llm/**`                                                                                                                                                                                               |
| 3       | `skills/**`                                                                                                                                                                                            |
| 4       | `teams/abstractions/**`, `teams/constraints/**`, `teams/registry/**`, `teams/services/**`, `teams/orchestrator/*`, `teams/factory/*`                                                                   |
| 5       | `orchestration/services`, `orchestration/services/*`（具体服务），`orchestration/executors/**`, `orchestration/state-machine/**`, `orchestration/utils/**`, `orchestration/interfaces/**`              |
| 6       | `rag/**`                                                                                                                                                                                               |
| 7       | `long-content/services/long-content-engine*`, `long-content/interfaces/**`, `long-content/types/**`, `long-content/long-content.module*`                                                               |
| 8       | `capabilities/**`, `realtime/**`, `memory/stores/**`, `memory/abstractions/**`, `memory/memory-coordinator.service*`, `content-fetch/**`, `interfaces/**`, `mcp/**`, `image/**`, `content-analysis/**` |
| 9       | `synthesis/**`, `search/**`, `quality/**`, `collaboration/**`, `guardrails/**`, `evidence/**`, `a2a/**`, `prompts/**`, `observability/**`, `constraint/**`, `common/**`, `api/**`                      |

**无覆盖缺口**。ai-engine 所有子目录均受 ESLint 规则防护。

---

## 六、Timer / 浮动 Promise [4/5]

### 6.1 已修复（commit `0f3b0b05`）

该提交为 31 处模块级 timer 补加 `.unref()`，防止 Jest 进程无法退出。涉及文件包括：

- `ai-app/social/core/publish-queue.service.ts` — 两个 setInterval
- `ai-app/social/services/playwright.service.ts` — cleanupInterval
- `ai-app/social/services/session-health-check.scheduler.ts` — setTimeout + setInterval
- `ai-app/teams/services/collaboration/mission/mission-health-check.service.ts`
- `ai-app/writing/services/mission/writing-mission-health-check.service.ts`
- `ai-engine/orchestration/services/circuit-breaker.service.ts`
- `ai-engine/orchestration/state-machine/execution-state.manager.ts`
- `ai-engine/search/search.service.ts`
- `ai-engine/skills/loader/skill-loader.service.ts`
- `core/admin/ai-admin.service.ts`
- 以及其他 20+ 处

同时修复了 floating promise：`publish-queue.service.ts`、`session-health-check.scheduler.ts`、`evidence-sync-compensation.service.ts`、`rate-limiter.ts`、`execution-state.manager.ts` 中的 setInterval 回调内异步调用均已添加 `void` 声明。

### 6.2 剩余未修复（2 处 — P3）

| 文件                                                             | 行号 | 类型          | 说明                                                                     | 严重度 |
| ---------------------------------------------------------------- | ---- | ------------- | ------------------------------------------------------------------------ | ------ |
| `integrations/feishu/feishu.service.ts`                          | 98   | `setInterval` | 构造函数中的 `cleanupInterval`，无 `.unref()`，有 `onModuleDestroy` 清理 | P3     |
| `ai-app/office/slides/services/slides-mission-health.service.ts` | 165  | `setTimeout`  | `onModuleInit` 中的 recovery delay，无 `.unref()`，一次性触发后自动结束  | P3     |

**说明**: 两处均有对应的 `clearInterval`/自然结束处理，不会造成 Jest 进程挂起的严重问题（一次性 setTimeout 会自然结束；feishu 有 `onModuleDestroy` 清理）。但规范上应加 `.unref()`。

**注意（合理豁免）**: 以下 timer 类型无需 `.unref()`：

- `Promise.race` 中的短暂 `setTimeout`（`slides-engine.service.ts:433`, `generation.service.ts:379`）— 短暂 resolve/reject 后自然销毁
- SSE 连接管理的 `setInterval`（`agents.controller.ts:143`, `discussion.controller.ts:68`）— 按请求生命周期管理，连接关闭时 clearInterval
- 研究/讨论 timeout guard（`discussion-orchestrator.service.ts:1159` 等）— 有配套 clearTimeout

### 6.3 任务执行心跳 timer（合理设计）

| 文件                               | 行号                                      | 说明                                                                                 |
| ---------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------ |
| `mission-execution.service.ts:368` | `heartbeatTimer = setInterval(...)`       | 有配套 `stopHeartbeat()` 调用 `clearInterval`，属任务生命周期管理，不需要 `.unref()` |
| `team-mission.service.ts:473`      | `heartbeatTimer = setInterval(...)`       | 同上                                                                                 |
| `mission-review.service.ts:243`    | `reviewHeartbeatTimer = setInterval(...)` | 同上                                                                                 |
| `team-mission.service.ts:2536`     | `reviewHeartbeatTimer = setInterval(...)` | 同上                                                                                 |

---

## 七、跨 App 依赖分析

### 7.1 已知 P3 技术债（有注释 — 豁免）

| 依赖关系                   | 路径                                         | 说明                                                                       |
| -------------------------- | -------------------------------------------- | -------------------------------------------------------------------------- |
| Planning → Teams（模块级） | `ai-planning.module.ts` 导入 `AiTeamsModule` | 有架构注释说明"受控的跨 App 依赖，待 Engine 提升 Mission/Topic 能力后消除" |

### 7.2 Office → Research/Writing（DI 令牌解耦 — 合规）

通过 `ai-app/shared/interfaces/data-export.interface.ts` 定义抽象接口（`IResearchDataExport`、`IWritingDataExport`）和 DI 令牌，符合依赖倒置原则。

### 7.3 无其他跨 App 直接依赖

全量扫描结果 0 处（排除合法的同模块相对导入）。

---

## 八、forwardRef 循环依赖治理

| 使用位置                                                                          | 原因                                                                                            | 合理性                  |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------- |
| `AiImageModule → AiEngineModule`                                                  | AiImageModule 依赖 AiEngineModule，AiEngineModule 通过 IMAGE_GENERATION_SERVICE_TOKEN 注入      | 已知循环，正确处理      |
| `AiOfficeModule → AiEngineModule`                                                 | 同上                                                                                            | 合规                    |
| `SlidesSkillsModule → AiEngineModule`                                             | 长循环链：AiEngineModule → AiImageModule → AiOfficeModule → SlidesSkillsModule → AiEngineModule | 有代码注释说明，合规    |
| `ResearchProjectModule → AiEngineModule`                                          | AudioGenerationTool 需要 ResearchProjectTTSService                                              | 合规，有注释            |
| `DiscussionModule → AiEngineModule`                                               | 研究讨论功能依赖 Engine                                                                         | 合规                    |
| `AdminModule ↔ AiEngineModule`                                                    | 管理层需要访问 Engine 内部服务                                                                  | 合规                    |
| `ContentExploreModule ↔ AdminModule`                                              | 探索模块需要 Admin                                                                              | 合规                    |
| `AiEngineOrchestrationModule ↔ AiEngineToolsModule/SkillsModule/ConstraintModule` | 编排层与工具/技能层循环                                                                         | 合规（Engine 内部循环） |
| `AiEngineLLMModule ↔ AiEngineOrchestrationModule`                                 | LLM 层与编排层循环                                                                              | 合规（Engine 内部）     |

**无未治理的循环依赖**。所有循环均有 `forwardRef` 包装和注释说明。

---

## 九、any 类型 [7/10]

ai-app 生产代码（排除测试文件、`eslint-disable` 行、`window as any` 等必要用法）约 17 处存量：

| 文件                                                            | 处数 | 类型说明                               |
| --------------------------------------------------------------- | ---- | -------------------------------------- |
| `ai-app/image/agents/image-designer.agent.ts`                   | 2    | `artifacts: any[]`, `artifact?: any`   |
| `ai-app/image/generation/image-generation.service.ts`           | 2    | `modelConfig: any`                     |
| `ai-app/office/slides/orchestrator/slides-team-orchestrator.ts` | 4    | `{} as any` 临时类型占位               |
| `ai-app/social/adapters/wechat.adapter.ts`                      | 1    | `window as any`（Playwright 注入必要） |
| `ai-app/social/adapters/wechat/wechat-publisher.service.ts`     | 1    | `window as any`（同上）                |
| `ai-app/social/services/playwright.service.ts`                  | 1    | `window as any`（同上）                |
| `ai-app/social/ai-social.service.ts`                            | 1    | `page: any`                            |
| `ai-app/research/project/research-project-output.service.ts`    | 2    | `sources: any[]`                       |
| `ai-app/teams/ai-teams.service.ts`                              | 1    | `linkPreview as any`                   |
| `ai-app/topic-insights/services/core/*.service.ts`              | ~2   | `let result: any`                      |

注：`window as any` 属 Playwright 脚本注入的必要模式，技术上无可替代，计为豁免。

---

## 十、代码规范 [满分 10/10]

### 10.1 console.log

- ai-app 生产代码：**0 处** `console.log`（benchmark 文件和 .example 文件不计）
- ai-engine 生产代码：facade 中的 `console.log` 均为 JSDoc 注释示例代码，非运行时代码；`document-processor.example.ts` 是示例文件，未被任何模块导入

**评定**: 合规。

### 10.2 品牌硬编码

扫描 `"Genesis"` / `"Raven"` / `"DeepDive"`（字符串字面量，排除注释）：**0 处**。

### 10.3 直接使用第三方 AI SDK

- `new OpenAI()` 在 `ai-engine/tools/categories/information/document-processor.example.ts:66` — 示例文件，未被任何模块导入，不计违规
- 无其他直接 SDK 调用绕过 `AiChatService`

---

## 十一、架构债务优先级矩阵

| 优先级 | 问题                                                                                              | 影响范围                    | 修复成本 | 建议时机 |
| ------ | ------------------------------------------------------------------------------------------------- | --------------------------- | -------- | -------- |
| P2     | `triage-decision.types.ts` 中 `temperature: 0.3, maxTokens: 2000` 未迁移至 TaskProfile            | 中（feedback 模块可能用到） | 低       | 本迭代   |
| P2     | `content/resources/config/ai-prompts.config.ts` requestDefaults 含 `temperature/maxTokens` 实际值 | 中（resources AI 调用链）   | 低       | 本迭代   |
| P2     | `core/user-api-keys` 和 `quota/anthropic` 中 `"claude-3-haiku-20240307"` 未提取为常量             | 低（API 版本变更维护风险）  | 极低     | 本周     |
| P2     | `core/admin` 中 `"llama-3.1-sonar-small-128k-online"` 未提取为常量（controller + service 两处）   | 低                          | 极低     | 本周     |
| P2     | `ai-app/image/core/image.constants.ts` `GEMINI_IMAGE_MODELS` 硬编码 — 应改为数据库驱动            | 低                          | 中       | 下次迭代 |
| P3     | `integrations/feishu/feishu.service.ts:98` cleanupInterval 无 `.unref()`                          | 极低                        | 极低     | 下次迭代 |
| P3     | `ai-app/office/slides/services/slides-mission-health.service.ts:165` setTimeout 无 `.unref()`     | 极低                        | 极低     | 下次迭代 |
| P3     | Planning → Teams 跨 App 依赖（有注释，待 Engine 提升 Mission/Topic 能力后消除）                   | 中                          | 高       | 长期     |
| P3     | `any` 类型：`slides-team-orchestrator.ts` 中 `{} as any` 临时占位符                               | 低                          | 低       | 下次迭代 |
| P3     | `any` 类型：`image-designer.agent.ts`、`research-project-output.service.ts` 补充具体类型          | 低                          | 低       | 下次迭代 |

---

## 十二、趋势分析

| 指标                 | 2026-02-24 v3 | 2026-02-25 v1 | 2026-02-25 v2  | 2026-02-25 v3（本次） | 趋势     |
| -------------------- | ------------- | ------------- | -------------- | --------------------- | -------- |
| 架构健康评分         | 82 / 100      | 83 / 100      | 84 / 100       | **87 / 100**          | 持续改善 |
| Facade 边界违规      | 2 处          | 0 处          | 0 处           | 0 处                  | 稳定满分 |
| LLM 硬编码（生产层） | 12+ 处        | 12 处         | 5 处           | **3 处**              | 显著改善 |
| 反向依赖             | 0 处          | 0 处          | 0 处           | 0 处                  | 稳定满分 |
| ESLint 覆盖缺口      | 1 处          | 0 处          | 1 处（新发现） | **0 处**              | 修复     |
| Timer .unref() 缺失  | 31 处         | 31 处         | 31 处          | **2 处**              | 显著改善 |
| any 类型（ai-app）   | ~20 处        | ~17 处        | ~17 处         | ~17 处                | 持平     |
| 品牌硬编码           | 0 处          | 0 处          | 0 处           | 0 处                  | 满分保持 |

---

## 十三、合规亮点

1. **Facade 边界零违规（第 3 次）** — 连续三次全量审计保持满分，ESLint 9 节规则防线稳固
2. **反向依赖零违规（第 3 次）** — ai-engine 层完全不知晓 ai-app 层，单向依赖严格执行
3. **注册模式 100% 合规** — 11 个 ai-app 子模块全部通过 `onModuleInit` 正确注册 Agent/Team/Skill
4. **ESLint memory 覆盖缺口及时闭合** — `c264e9c4` 修复了 v2 发现的 24 小时内即被修复
5. **Timer .unref() 批量修复** — `0f3b0b05` 一次性修复 31 处，显示了对架构规范的主动跟进
6. **LLM 硬编码从 12+ 处降至 3 处** — 三次迭代持续清理，ai-app 层业务层已接近零
7. **console.log 零违规** — 全库生产代码杜绝 console.log，全面使用 NestJS Logger

---

## 十四、建议行动项

### 必须处理（本迭代）

- [ ] 修复 P2：`triage-decision.types.ts:288` 将 `temperature: 0.3, maxTokens: 2000` 改为 `taskProfile: { creativity: "low", outputLength: "short" }`
- [ ] 修复 P2：确认 `content/resources/config/ai-prompts.config.ts` 的 `requestDefaults.temperature` 是否被实际调用链使用，如是则迁移至 TaskProfile

### 计划处理（本周）

- [ ] 修复 P2：提取 `"claude-3-haiku-20240307"` 为 `ANTHROPIC_TEST_MODEL` 常量，统一 `user-api-keys.service.ts` 和 `anthropic-quota.provider.ts` 两处引用
- [ ] 修复 P2：提取 `"llama-3.1-sonar-small-128k-online"` 为 `PERPLEXITY_TEST_MODEL` 常量，统一 `admin.controller.ts` 和 `admin.service.ts` 两处引用

### 下次迭代

- [ ] 修复 P3：`feishu.service.ts:98` 和 `slides-mission-health.service.ts:165` 补加 `.unref()`
- [ ] 修复 P3：`slides-team-orchestrator.ts` 中 `{} as any` 临时占位符补充具体类型
- [ ] 讨论 P2：`GEMINI_IMAGE_MODELS` 是否改为数据库驱动的模型能力标记（`supportsImageGeneration`）

### 长期改进

- [ ] 消除 Planning → Teams 跨 App 依赖（待 AiEngineModule 将 Mission/Topic 提升为引擎级能力）
- [ ] 建立月度架构审计机制（下次建议: 2026-03-25）
- [ ] 考虑添加 pre-commit hook 运行 ESLint no-restricted-imports 检查

---

_下次建议审计时间: 2026-03-25（距今约 1 个月）_
_报告生成工具: Arch Auditor Agent v1.0 (claude-sonnet-4-6)_
_审计基准提交: `b5213ba1` — "chore: clean up garbage files and misplaced artifacts"_
