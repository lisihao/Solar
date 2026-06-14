# AI Engine 层架构质量审计报告

**审计日期**: 2026-03-02
**审计版本**: df90c16f (git HEAD)
**审计员**: Arch Auditor Agent v2.0
**审计范围**: `backend/src/modules/ai-engine/` 全量代码

## 代码库普查

| 统计项                  | 数量       |
| ----------------------- | ---------- |
| 生产 TS 文件            | 422        |
| 测试 spec 文件          | 223        |
| 测试覆盖率（文件比）    | 52.8%      |
| 顶级子模块              | 15 个      |
| Controller 文件         | 7 个       |
| Controller 有 spec 文件 | 0 / 7 (0%) |

---

## 执行摘要

| #        | 审计维度                            | 满分   | 得分      | 状态                          |
| -------- | ----------------------------------- | ------ | --------- | ----------------------------- |
| 1        | 模块内聚性                          | 10     | 7         | 基本健康，有结构性债务        |
| 2        | 接口设计（Domain Facades）          | 10     | 8         | 良好，迁移进行中              |
| 3        | 安全性（Guardrails/Injection 防护） | 10     | 7         | 已建立框架，有覆盖缺口        |
| 4        | 错误处理（CircuitBreaker/Fallback） | 10     | 8         | 健壮，少量静默 catch          |
| 5        | 测试覆盖                            | 10     | 5         | Controller 层零覆盖           |
| 6        | 代码质量                            | 10     | 8         | 优秀，少量 any 和 process.env |
| 7        | 依赖合理性（无反向依赖）            | 10     | 7         | 有 `import type` 反向引用     |
| 8        | 扩展性（Registry/MCP）              | 10     | 9         | Registry 模式优秀             |
| **总分** |                                     | **80** | **59/80** | **73.8/100（折算）**          |

> 注：本报告使用 8 维度专项模型（每项 10 分，满分 80）评估 ai-engine 内部质量，非全库 12 维度评分。

---

## D1: 模块内聚性 [7/10]

### 得分依据

**正向**：

- `llm/`、`agents/`、`tools/`、`skills/`、`orchestration/`、`knowledge/` 分工清晰，各有独立子模块
- `facade/` 已完成 Phase 5 拆分：`ChatFacade`、`RAGFacade`、`AgentFacade`、`TeamFacade`、`ToolFacade` 并行存在
- `safety/guardrails/` 与 `safety/constraint/` 分别承担不同职责：前者是新 Pipeline 框架（IInputGuardrail/IOutputGuardrail），后者是遗留 ContentFilter/RateLimiter

**问题 -3 分**：

**问题 1：safety 子目录双轨制混乱（-1）**

存在两套并行的 guardrail 实现：

- `safety/constraint/guardrails/` — 遗留实现（ContentFilter、CostController、RateLimiter），非 Injectable，工厂模式创建
- `safety/guardrails/` — 新 Pipeline 框架（PromptInjectionDetector、ContentSafetyFilter、ContentComplianceCheck），@Injectable

两套同时注册到 `AiEngineConstraintModule`，职责边界未明确说明哪套是权威，文档和注释均以"Legacy"和"New Framework"区分，但未给出统一迁移计划。

```
backend/src/modules/ai-engine/safety/
├── constraint/
│   └── guardrails/     # 遗留: ContentFilter / CostController / RateLimiter
├── guardrails/         # 新: PromptInjectionDetector / ContentSafetyFilter
└── quality/            # 质量检查器
```

**问题 2：orchestration/services/iteration-manager.service.ts 使用内存 VersionStore（-1）**

文件 `orchestration/services/iteration-manager.service.ts`（1073 行）中：

```typescript
// TODO: 后续迁移到数据库持久化
private readonly store: VersionStore = {
  outputs: new Map<string, StructuredOutput[]>(),
  contexts: new Map<string, ResearchContext>(),
};
```

多实例部署下会丢失状态，且无 LRU 限制，内存无上界。

**问题 3：tools/deprecated/ 目录未清理（-1）**

`tools/deprecated/` 包含 `javascript-executor.tool.ts`、`python-executor.tool.ts`、`shell-executor.tool.ts`，README 说明废弃原因，但这些文件仍在 repo 中，增加代码库浏览负担。

---

## D2: 接口设计（Domain Facades）[8/10]

### 得分依据

**正向**：

- 5 个 Domain Facade 设计合理，职责边界清晰：
  - `ChatFacade`：LLM 聊天、流式、模型选择、Billing（1062 行，含子 Facade 委托）
  - `RAGFacade`：搜索、上下文构建、记忆操作、向量搜索
  - `AgentFacade`：Agent 执行、Trace/Span 生命周期、意图路由、Realtime
  - `TeamFacade`：Team Mission 生命周期、A2A、反思、证据/投票
  - `ToolFacade`：工具执行、发现、能力解析、MCP 管理
- `facade/index.ts` 全量导出，消费方只需从单一入口 import
- 子 Facade 模式（`ModelSubFacade`、`MemorySubFacade` 等）有效降低单个 Facade 复杂度

**问题 -2 分**：

**问题 1：AIEngineFacade（God Object）仍保留大量直接实现（-1）**

`ai-engine.facade.ts` 共 2978 行，38 个 async 方法。`@deprecated` 注释已到位，但尚未将方法体委托到对应 Domain Facade：

```typescript
// ai-engine.facade.ts 中搜不到任何 this.chatDomain.xxx / this.ragDomain.xxx 调用
grep "this.chatDomain\|this.ragDomain\|this.agentDomain\|this.teamDomain\|this.toolDomain" ai-engine.facade.ts
# 结果: 0 行
```

Domain Facades 作为可选注入存在，但 AIEngineFacade 的方法体实际仍是自己实现，未真正委托。迁移停留在"并行存在"阶段，未进入"委托并淘汰"阶段。

**问题 2：RAGFacade 包含直接 Prisma 访问（-1）**

`rag.facade.ts` 中 `buildContext()` 方法通过 `this.prisma.researchTopic.findUnique()` 和 `this.prisma.resource.findUnique()` 直接查询数据库：

```typescript
// backend/src/modules/ai-engine/facade/domain/rag.facade.ts:204
this.logger.warn(`[buildContext] Deprecated: type="topic" with id="${source.id}" should pass data via source.data instead of direct Prisma query`);
const topic = await this.prisma.researchTopic.findUnique({ ... });
```

Facade 层直接持有 PrismaService 并执行领域查询，违反"Facade 只做路由和适配"原则。这些查询属于 ai-app 层的业务逻辑，不应下沉到 ai-engine 的 RAG Facade。路径已标为 Deprecated 但代码仍可执行。

---

## D3: 安全性 [7/10]

### 得分依据

**正向**：

- Prompt Injection 检测器覆盖 8 类攻击模式（ignore instructions、jailbreak、role manipulation、system prompt extraction 等）
- Content Safety Filter 检测 PII（邮件、手机号、信用卡、SSN、中国身份证）
- A2A API Key Guard 已迁移到 ai-kernel，shim 层正确转发
- GuardrailsPipeline 在 AiChatService 和 MCP Server 两个关键调用点均已接入
- `SENSITIVE_PATTERNS` 在 ChatFacade 和 AIEngineFacade 中对 LLM 响应做敏感词脱敏

**问题 -3 分**：

**问题 1：Guardrails 未覆盖 Agent Orchestrator 直调路径（-1）**

`agents/registry/agent-orchestrator.ts` 通过 `@Optional()` 注入 `GuardrailsPipelineService`，但未见在执行路径中调用 `processInput()` / `processOutput()`。Agent 直接执行时绕过了 Guardrails Pipeline：

```typescript
// agent-orchestrator.ts:41
@Optional() private readonly guardrailsPipeline?: GuardrailsPipelineService,
// 注入了但未在 execute() 路径中使用
```

**问题 2：integration 工具直接读取 process.env（-1）**

以下两个工具（属于 ai-engine/tools）直接读取 process.env，未通过 ConfigService：

- `tools/categories/integration/email-sender.tool.ts`（第 160-163、335-336 行）
- `tools/categories/integration/message-push.tool.ts`（第 725-731、738 行）

工具层是无状态 Injectable，理论上可以注入 ConfigService，但目前两个文件共 12 处直接 `process.env.SMTP_*` 访问。

**问题 3：Prompt Injection 检测器的 "you are now a/an" 模式过于宽泛（-1）**

```typescript
// prompt-injection-detector.ts:65
{ pattern: /you\s+are\s+now\s+(a|an)\s+/gi, name: "Role Manipulation", severity: "warning" },
```

此 Pattern 会对正常学习类对话（"You are now a teacher in this conversation"）产生误报，导致 Guardrail "warning" 噪音增加，并可能降低研发信任度（关掉 `GUARDRAILS_ENABLED`）。建议收窄模式或提升触发阈值。

---

## D4: 错误处理 [8/10]

### 得分依据

**正向**：

- CircuitBreaker 已迁移到 ai-kernel，ai-engine 通过 shim 层使用
- ModelFallbackService 设计完善：区分"可重试错误"（同模型重试）vs "需切换模型错误"（quota/api_key），逻辑清晰
- 大多数 `.catch((err) =>` 均有 `this.logger.xxx()` 记录
- AiChatService 使用 `AiChatRetryService` 统一管理重试策略
- 内部工具调用 `catch()` 正确地返回 `[]`（graceful degradation）而非 throw

**问题 -2 分**：

**问题 1：memory-coordinator.service.ts 有 4 处静默 catch（-1）**

`knowledge/memory/memory-coordinator.service.ts` 的 `recall()` 方法：

```typescript
// 第 129-138 行
? this.recallLayer1(query, sessionId).catch(() => [])
? this.recallLayer2(query, sessionId).catch(() => [])
? this.recallLayer3(query, userId).catch(() => [])
? this.recallLayer4(query, userId).catch(() => [])
```

这 4 处 `.catch(() => [])` 无任何日志，记忆层失败会静默降级为空。虽然对于记忆系统 graceful degradation 是合理的，但应至少 `logger.warn()` 记录层次失败，便于诊断记忆质量问题。

**问题 2：agents/agents.service.ts 使用裸 throw new Error（-1）**

```typescript
// agents/api/agents.service.ts:258
throw new Error("Artifact not found");
```

在 NestJS 服务中应使用 `NotFoundException`（`HttpException` 子类），以便全局异常过滤器正确转换 HTTP 状态码。类似问题还见于 `ai-core.service.ts:53`、`prompt-registry.service.ts:138、145`。

---

## D5: 测试覆盖 [5/10]

### 得分依据

**正向**：

- 文件覆盖率 52.8%（223 spec / 422 prod），高于 30% 基线
- Domain Facade 层覆盖完整：`chat.facade.spec.ts`、`rag.facade.spec.ts`、`agent.facade.spec.ts`、`team.facade.spec.ts`、`tool.facade.spec.ts`
- `ai-engine.facade.spec.ts`（含 extended/structured/supplemental 四个文件）
- 核心 LLM、Knowledge、Orchestration 路径均有 spec

**问题 -5 分**：

**问题 1：全部 7 个 Controller 缺少 spec 文件（-4）**

| Controller                                        | spec 状态     |
| ------------------------------------------------- | ------------- |
| `ai-core.controller.ts`（1334 行）                | 缺失          |
| `agents/api/agents.controller.ts`                 | 缺失          |
| `teams/controllers/teams.controller.ts`           | 缺失          |
| `skills/api/skills.controller.ts`                 | 缺失          |
| `infra/observability/observability.controller.ts` | 缺失          |
| `mcp/admin/mcp-external-admin.controller.ts`      | 缺失          |
| `infra/a2a/a2a.controller.ts`                     | 仅 shim，可免 |

Controller 层是 HTTP 接口的第一道防线，直接影响 API 合约稳定性，零覆盖是最高优先级测试债务。

**问题 2：agents.controller.ts 缺少 Auth Guard（-1）**

`agents/api/agents.controller.ts` 有 `@ApiTags("AI Agents")` 和 `@ApiOperation` 但无 `@UseGuards` 注解。考虑到系统级 `APP_GUARD` 使用 `JwtAuthGuard`，实际运行时是受保护的，但代码中未显式声明，不利于安全审查和测试 mock。

---

## D6: 代码质量 [8/10]

### 得分依据

**正向**：

- `any` 类型使用仅 10 处（生产文件），远低于 50 处阈值
- 零 `@ts-ignore` / `@ts-expect-error`
- console.log 仅出现在 JSDoc 示例注释和 `.example.ts` 文件中，实际运行代码中无违规
- 全面使用 NestJS Logger

**问题 -2 分**：

**问题 1：ai-engine.facade.ts 2978 行，ai-core.controller.ts 1334 行（-1）**

两个文件超过 500 行阈值，其中 `ai-engine.facade.ts` 以 2978 行居全库最大，但已有明确的迁移方向（Domain Facades）。`mission-orchestrator.ts`（2380 行）同样超大，但其复杂度有合理性。

**问题 2：`email-sender.tool.ts` 和 `message-push.tool.ts` 中硬编码默认值（-1）**

```typescript
// email-sender.tool.ts:160
const host = process.env.SMTP_HOST || "smtp.gmail.com"; // 硬编码服务商
```

虽为 fallback 值，但硬编码 `smtp.gmail.com` 是品牌/服务商名，在不同部署环境下可能引发混乱。

---

## D7: 依赖合理性 [7/10]

### 得分依据

**正向**：

- ai-engine 的绝大多数文件不 import ai-app 任何模块
- 层次边界整体清晰：ai-engine → ai-infra → common，单向依赖

**问题 -3 分**：

**问题 1：facade/ai-engine.facade.ts 和 facade/facade.providers.ts 反向引用 ai-app（-2）**

```typescript
// facade/ai-engine.facade.ts:187-188
import type { LongContentEngineService } from "../../ai-app/writing/content-engine/services/long-content-engine.service";
import type { ContinuationProtocolService } from "../../ai-app/writing/content-engine/services/continuation-protocol.service";

// facade/facade.providers.ts:43-44, 54
import type { LongContentEngineService } from "../../ai-app/writing/content-engine/...";
import type { ContinuationProtocolService } from "../../ai-app/writing/content-engine/...";
import type { ReportSynthesisEngine } from "../../ai-app/office/content-synthesis/...";
```

虽然均为 `import type`（TypeScript 类型擦除，运行时零影响），但在架构层面违反了 L2 → L4 单向依赖规则。`import type` 的反向引用是"类型边界泄漏"——说明这些类型定义位置不正确，应将相关类型定义上移到 ai-engine/facade/types 或 ai-engine/core/interfaces，而非让 ai-engine 知道 ai-app 的存在。

这些引用的历史背景（注释 `Phase 3: long-form moved to ai-app/writing/content-engine/`）说明是 Phase 3 重构时的遗留：服务移走了，但类型引用未同步提取。

**问题 2：rag.facade.ts 直接注入 PrismaService 查询 ai-app 领域数据（-1）**

`RAGFacade` 注入 `PrismaService` 并查询 `researchTopic` 和 `resource` 模型，这两个模型属于 `ai-app/research` 和 `content/resources` 的领域数据。这是 ai-engine 层对 ai-app 领域数据的直接耦合，比 `import type` 更严重，因为有运行时 DB 查询。

---

## D8: 扩展性 [9/10]

### 得分依据

**正向**：

- Registry 模式（`AgentRegistry`、`TeamRegistry`、`ToolRegistry`、`SkillRegistry`、`RoleRegistry`）均继承自 `BaseRegistry<T>`，接口统一
- `SkillRegistry` 多维索引（by Layer、by Domain、by Tag）支持灵活查询
- `MCPManager` 使用 `LruMap<string, IMCPClient>(50)` 防止内存无界增长
- MCP Client Factory 支持 stdio、HTTP、SSE 三种 transport，策略模式扩展
- `GuardrailsPipeline` 动态注册（`registerInputGuardrail` / `registerOutputGuardrail`），支持运行时插件化
- `AiEngineConstraintModule.onModuleInit()` 正确使用 NestJS 注册模式
- `ModelFallbackService` 泛型 `executeWithFallback<T>()` 支持任意返回类型

**问题 -1 分**：

**问题 1：human-approval.tool.ts 和 agent-handoff.tool.ts 存在 TODO 占位实现（-1）**

```typescript
// tools/categories/collaboration/human-approval.tool.ts:428
// TODO: 实际实现需要：...

// tools/categories/collaboration/agent-handoff.tool.ts:356
// TODO: 实际执行目标 Agent 任务
```

这两个协作工具是 Agent 协作框架的重要扩展点，但核心执行逻辑尚未实现。注册到 ToolRegistry 后，调用方可能在运行时收到空响应或错误结果，缺少明确的"未实现"错误提示。

---

## 架构债务优先级矩阵

| 优先级 | 问题                                                    | 维度  | 影响范围       | 修复成本       | 建议时机 |
| ------ | ------------------------------------------------------- | ----- | -------------- | -------------- | -------- |
| P0     | 全部 7 个 Controller 缺少 spec                          | D5    | API 合约稳定性 | 中             | 本迭代   |
| P0     | AgentOrchestrator 未调用 Guardrails Pipeline            | D3    | Agent 安全性   | 低             | 本迭代   |
| P1     | `facade/facade.providers.ts` 反向 `import type` ai-app  | D7    | 架构边界       | 低（提取类型） | 本迭代   |
| P1     | AIEngineFacade 未实际委托 Domain Facades                | D2    | 迁移完成度     | 高             | 下次迭代 |
| P1     | RAGFacade 直接查询 ai-app 领域数据（Prisma）            | D7/D2 | 层次耦合       | 中             | 下次迭代 |
| P2     | memory-coordinator 4 处静默 catch 无日志                | D4    | 诊断能力       | 低             | 下次迭代 |
| P2     | iteration-manager 内存 VersionStore（无持久化、无 LRU） | D1    | 多实例/内存    | 中             | 下次迭代 |
| P2     | email-sender/message-push 工具 process.env 直调         | D3    | 配置管理       | 低             | 下次迭代 |
| P2     | 裸 throw new Error 应换为 HttpException 子类            | D4    | 异常一致性     | 低             | 下次迭代 |
| P3     | safety 双轨制 guardrail 缺统一迁移计划                  | D1    | 代码可维护性   | 中             | 长期     |
| P3     | tools/deprecated/ 目录未清理                            | D1    | 代码库整洁度   | 低             | 长期     |
| P3     | PromptInjection "you are now a/an" 模式误报率高         | D3    | Guardrail 精度 | 低             | 长期     |
| P3     | human-approval / agent-handoff TODO 占位实现            | D8    | 协作扩展点     | 高             | 长期     |

---

## 建议行动项

### 必须处理（本迭代，P0）

- [ ] **为 7 个 Controller 补充 spec 文件**
  - 优先级：`ai-core.controller.ts`（最大、最高风险）、`agents.controller.ts`、`teams.controller.ts`
  - 测试策略：mock 所有 Service 依赖，验证路由参数、响应格式、异常处理
  - 目标：Controller spec 覆盖率从 0% 提升到 100%

- [ ] **在 AgentOrchestrator 执行路径中接入 Guardrails**
  - 文件：`backend/src/modules/ai-engine/agents/registry/agent-orchestrator.ts`
  - 在 Agent `execute()` 前调用 `guardrailsPipeline.processInput()`，在结果返回前调用 `processOutput()`
  - 与 `AiChatService` 中已有的接入模式保持一致

### 计划处理（下次迭代，P1/P2）

- [ ] **提取 facade/facade.providers.ts 中的反向 `import type`**
  - 将 `LongContentEngineService`、`ContinuationProtocolService`、`ReportSynthesisEngine` 相关接口类型定义提取到 `ai-engine/facade/types/` 或 `ai-engine/core/interfaces/`
  - 消除 ai-engine 对 ai-app 的任何 import（包括 import type）

- [ ] **推进 AIEngineFacade 委托迁移**
  - 目标：`ai-engine.facade.ts` 的 38 个方法应调用 `this.chatDomain?.xxx()` 等方式委托给对应 Domain Facade
  - 通过 `??` 降级到自身实现保证向后兼容，逐方法推进

- [ ] **将 RAGFacade Prisma 直查改为参数传入**
  - `buildContext()` 中 `type="topic"` 和 `type="resource"` 的两条 Deprecated 路径应彻底删除，要求调用方通过 `source.data` 传入数据
  - 文件：`backend/src/modules/ai-engine/facade/domain/rag.facade.ts`

- [ ] **memory-coordinator 4 处静默 catch 补充日志**
  - 文件：`backend/src/modules/ai-engine/knowledge/memory/memory-coordinator.service.ts:129-138`
  - 改为 `.catch((err) => { this.logger.warn(...); return []; })`

- [ ] **IterationManager 内存 VersionStore 设置 LRU 上限**
  - 文件：`backend/src/modules/ai-engine/orchestration/services/iteration-manager.service.ts`
  - 短期：使用 `LruMap` 替换 `Map`，设置 `outputs` 最大 100 条
  - 长期：迁移到数据库持久化（已有 TODO）

- [ ] **integration 工具改用 ConfigService**
  - 文件：`email-sender.tool.ts`、`message-push.tool.ts`
  - 注入 `ConfigService`，替换 12 处 `process.env.SMTP_*`

- [ ] **裸 throw new Error 统一替换**
  - `agents/api/agents.service.ts:258` → `NotFoundException`
  - `api/ai-core.service.ts:53` → `ServiceUnavailableException`
  - `llm/prompts/prompt-registry.service.ts:138、145` → `NotFoundException`

### 长期改进（P3）

- [ ] **清理 tools/deprecated/ 目录**，将三个废弃文件从代码库删除

- [ ] **统一 safety 双轨制**：明确 `constraint/guardrails/` 遗留实现的废弃时间线，逐步迁移 CostController/RateLimiter 到新 Pipeline 框架

- [ ] **收窄 PromptInjection 误报模式**：`"you are now a/an"` 改为更精准的 pattern（如结合上下文、过滤系统级设定场景）

- [ ] **human-approval / agent-handoff 完成实现**：这两个工具注册后调用方会得到空响应，应添加明确的 `NotImplementedException` 或 "功能开发中" 的明确错误提示

---

## 各子模块简评

| 子模块                 | 评价                                                                  | 主要风险                                                                    |
| ---------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `llm/`                 | 良好。AiChatService 精简为 Thin Coordinator，子服务职责清晰           | ai-connection-test.service 4 处硬编码 temperature:0 属 test-specific 可接受 |
| `facade/`              | 进行中。Domain Facades 结构良好，God Facade 迁移卡在"并行"阶段        | AIEngineFacade 2978 行，未真正委托                                          |
| `agents/`              | 良好。Registry/Orchestrator/Collaboration 分层合理                    | Controller 无 spec，AgentOrchestrator 未接 Guardrails                       |
| `teams/`               | 良好。MissionOrchestrator 承载复杂度，有 DAG/Sequential/Parallel 支持 | teams.controller.ts 无 spec，CreateMissionRequestDto 缺 class-validator     |
| `tools/`               | 良好。48+ 工具分 8 类，BaseRegistry 统一                              | deprecated 目录未清理，integration 工具直读 process.env                     |
| `skills/`              | 良好。多维索引 Registry，Builder/Loader/Runtime 分工清晰              | skills.controller.ts 无 spec                                                |
| `orchestration/`       | 良好。已迁移 CircuitBreaker 到 ai-kernel                              | IterationManager 内存 Store，interfaces.ts 1073 行过大                      |
| `knowledge/rag/`       | 良好。Embedding/Vector/Chunker/Pipeline 四层分离                      | LongTermMemory TODO: 应使用向量语义搜索                                     |
| `knowledge/memory/`    | 良好。4 层记忆架构（短期/长期/会话/知识图谱）                         | recall() 4 处静默 catch                                                     |
| `mcp/`                 | 优秀。LruMap、多协议 Factory、Admin 分离                              | -                                                                           |
| `safety/guardrails/`   | 良好。Pipeline + 动态注册框架完善                                     | 双轨制，AgentOrchestrator 未接入                                            |
| `infra/observability/` | 良好。TraceCollector 已迁移 ai-kernel，shim 正确                      | observability.controller.ts 无 spec                                         |
| `infra/a2a/`           | 良好。A2AController/Guard 均迁移 ai-kernel，shim 正确                 | A2A inbound 接口（createTask/getTaskStatus）仍为 TODO                       |
| `infra/realtime/`      | 良好。EngineEventEmitter + ProgressTracker 分离                       | WebSocket Gateway 是 TODO，尚未实现                                         |
| `content/`             | 良好。Image 多适配器（OpenAI/Stability/Together），ContentFetch 统一  | -                                                                           |

---

_审计模型: AI Engine 专项 8 维度_
_下次建议审计: 2026-04-02（月度定期）或 AIEngineFacade 委托迁移完成后_
_报告工具: Arch Auditor Agent v2.0_
