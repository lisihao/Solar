# 架构质量深度评估报告 - 2026-02-24

**评估日期**: 2026-02-24
**评估版本**: 34b0d17a
**评估人**: Arch Auditor Agent (Sonnet 4.6)
**评估范围**: 全量代码库深度质量分析（内聚度/耦合度、测试覆盖率、Facade 质量、演进对齐度、扩展性热点）
**前置参考**: `docs/audits/2026-02-24_arch-audit-v3.md`（合规审计，健康评分 73/100）

---

## 执行摘要

| 维度                    | 评分       | 主要问题                                                             | 风险等级 |
| ----------------------- | ---------- | -------------------------------------------------------------------- | -------- |
| 模块内聚度与耦合度      | 52/100     | Facade 2920 行 / Writing 模块 50+ providers                          | 高       |
| 测试覆盖率质量          | 4/100      | ai-app 覆盖率 0%，仅 18/226 文件有任何覆盖                           | 严重     |
| AIEngineFacade 质量     | 61/100     | 42 个 public 方法 + 37 个 getter，ISP 违规显著                       | 高       |
| AI Evolution 演进对齐度 | 68/100     | TraceCollector/EvalPipeline/QualityGate 存在，evolution 模块尚未创建 | 中       |
| 架构扩展性热点          | 55/100     | 3 个超高变更文件，Facade 是所有 App 的单一变更汇聚点                 | 高       |
| **综合架构质量评分**    | **48/100** | **测试危机是最高优先级，Facade 臃肿是第二优先级**                    | **严重** |

**最高风险区域**:

1. 整体测试覆盖率 3.77%（statements），ai-app 模块 100% 零覆盖
2. `AIEngineFacade`（2920 行，42 方法，37 getter，37 @Optional 依赖）—— 违反 ISP 和 SRP
3. `AiWritingModule`（50+ providers）—— 模块边界已丧失意义

**最紧迫行动项**:

- P0: 建立 ai-app 测试基线（从业务核心路径开始）
- P1: 拆分 AIEngineFacade 为 3-5 个 @Injectable 子 Facade
- P1: Writing 模块按领域边界拆分为子模块

---

## 一、模块内聚度与耦合度

### 1.1 AIEngineFacade 臃肿度分析

**源文件**: `backend/src/modules/ai-engine/facade/ai-engine.facade.ts`

| 指标                       | 数值                                                                                                             | 评估         |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------ |
| 总行数                     | 2920 行                                                                                                          | 危险         |
| Public async 方法          | 42 个                                                                                                            | 严重违反 ISP |
| Public getter 属性         | 37 个                                                                                                            | 高           |
| Constructor @Optional 依赖 | 37 个                                                                                                            | 严重         |
| Sub-facade 数量            | 5 个（ModelSubFacade, TeamSubFacade, MemorySubFacade, AgentSubFacade, ToolExecSubFacade）                        | 已有缓解     |
| 特性分组 Token             | 6 个（MEMORY_FEATURE, TOOL_FEATURE, ORCHESTRATION_FEATURE, SKILL_FEATURE, REALTIME_FEATURE, CONSTRAINT_FEATURE） | 好的尝试     |

**公开方法分类（42 个 async 方法）**:

- LLM 调用层（chat, chatStructured, chatWithSkills, search）: 4 个
- 模型管理层（selectModel, getReasoningModel, getAvailableModelsExtended, getAvailableModels, getDefaultTextModel, getDefaultImageModel, getModelById, getFullModelConfig, getDefaultModelByType, fetchAvailableModels, testModelConnectionWithKey）: 11 个
- 上下文/记忆层（buildContext, storeMemory, retrieveMemory, clearMemory, sessionMemoryGet, sessionMemorySet, sessionMemoryClear）: 7 个
- Agent 执行层（executeAgent, executeTool, chatWithTools）: 3 个
- 能力解析层（getAvailableCapabilities, capabilityResolveTools, capabilityGetSkillPrompts, skillLoaderGetAll）: 4 个
- 向量/RAG 层（embeddingGenerate, embeddingGetModel, vectorSimilaritySearch）: 3 个
- Observability 层（trace\* 相关）: 多个
- Team Mission 层（startTeamMission）: 1 个
- Skill 执行层（executeSkill）: 1 个
- 其他（selectModel, 搜索等）: 8 个

**问题诊断**: Sub-facade 模式（5 个 plain class）是正确方向，但 AIEngineFacade 仍然是实际的构造函数注入点，持有全部 37 个 @Optional 依赖。这意味着每个 AI App 注入 AIEngineFacade 时，实际承载的是整个引擎的所有依赖树。37 个 getter 将内部服务直接暴露给 App 层（`get mcpManager()`, `get circuitBreaker()`, `get teamFactory()`），这已不是 Facade 模式而是依赖透传器（Pass-through Locator），严重违反封装原则。

**ISP 违规**: 一个 Research Agent 使用 Facade 时，同时装载了 VotingManager、EvidenceManager、LongContentEngine、MCP 等完全不相关的能力。ISP 要求客户端不应被迫依赖它不使用的接口。

### 1.2 Teams 模块职责分析

**源文件**: `backend/src/modules/ai-app/teams/ai-teams.module.ts`

| 指标           | 数值                                                      |
| -------------- | --------------------------------------------------------- |
| providers 总数 | 35 个                                                     |
| 控制器数量     | 5 个                                                      |
| 服务类别       | 6 类（AI 服务、协作服务、长内容、Topic 领域、事件、整合） |

**服务清单分析**:

- Topic CRUD（TopicCrudService, TopicMembershipService, TopicPublicService 等）: 纯数据层
- Mission 协作（MissionExecutionService, MissionReviewService, TaskBreakdownService 等）: AI 编排层
- AI 服务（ContextRouterService, AiResponseService, TeamsLongContentService 等）: AI 调用层
- 辩论（DebateService）: 特定业务逻辑

**评估**: Teams 模块承担了 3 个截然不同的职责 —— (1) 社交话题管理（Topic CRUD），(2) AI 任务编排（Mission），(3) 对话/辩论 AI。这三层之间的耦合度很高，导致 35 个 provider 集中在一个 Module 中。Topic 领域（纯 DB 操作）与 Mission 编排（AI 调用）应该分属不同的模块边界。

**SRP 评分**: 6/10（有 6 个 service 分类，但同在一个 Module，职责混合）

### 1.3 各模块耦合复杂度排名

基于 `.module.ts` 文件的 `providers` 数量统计（直接读取文件）：

| 排名 | 模块                                  | Providers 数量    | 评估                                                     |
| ---- | ------------------------------------- | ----------------- | -------------------------------------------------------- |
| 1    | `ai-app/writing/ai-writing.module.ts` | 50+               | 严重臃肿，12 个服务子类别                                |
| 2    | `ai-app/teams/ai-teams.module.ts`     | 35                | 高，3 个职责域混合                                       |
| 3    | `ai-engine/ai-engine.module.ts`       | 25+（加上子模块） | 有子模块拆分，可接受                                     |
| 4    | `ai-app/office/ai-office.module.ts`   | 14                | 中等，但跨 App 依赖（导入 ResearchModule+WritingModule） |
| 5    | `ai-app/research/research.module.ts`  | 7（+ 子模块）     | 好，已有子模块化                                         |

**Writing 模块深度问题**: `AiWritingModule` 一次性注册了：Bible 服务（5个）、Writing 服务（9个）、Mission 服务（11个）、Consistency 服务（8个）、Parallel 服务（4个）、Quality 服务（18个）、Style 服务（1个）、Agents（5个）。共计 50+ providers，模块 ts 文件自身约 260 行，服务之间形成密集的内部依赖网。这是项目中最严重的内聚度问题。

### 1.4 跨 App 模块直接依赖

**`ai-app/office/ai-office.module.ts`** 直接导入：

```
imports: [ResearchModule, AiWritingModule, ...]
```

这意味着 Office 模块直接依赖 Research 和 Writing 两个兄弟 App 模块。这是跨 App 直接耦合，违反了 App 之间通过 AI Engine 中转的原则。SlidesDataImportService 通过 `RESEARCH_DATA_EXPORT`/`WRITING_DATA_EXPORT` DI Token 解耦了类型，但模块导入关系仍然是硬耦合。

---

## 二、测试覆盖率质量

### 2.1 整体覆盖率概览

**覆盖率来源**: `backend/coverage/coverage-summary.json`

| 指标       | 已覆盖 | 总量   | 覆盖率    |
| ---------- | ------ | ------ | --------- |
| Lines      | 754    | 19,523 | **3.86%** |
| Statements | 778    | 20,590 | **3.77%** |
| Functions  | 84     | 3,496  | **2.40%** |
| Branches   | 376    | 10,682 | **3.51%** |

**总文件数**: 226 个 TypeScript 文件被 Istanbul 跟踪
**有任何覆盖的文件**: 18 个（8%）
**完全零覆盖且 >= 20 条语句的文件**: 193 个（85%）

这一覆盖率数字代表的是一场**测试危机**，不是"覆盖率偏低"。在生产级的 AI 平台上，整个 ai-app 层（所有业务逻辑）的覆盖率是 0%。

### 2.2 高风险低覆盖文件 TOP 20（核心路径）

以下是零覆盖且语句总数最多的文件（已按语句数排序，均来自 ai-engine）：

| 排名 | 文件路径                                                                 | 语句数 | 覆盖率 | 风险 |
| ---- | ------------------------------------------------------------------------ | ------ | ------ | ---- |
| 1    | `modules/ai-engine/teams/orchestrator/mission-orchestrator.ts`           | 648    | 0%     | 严重 |
| 2    | `modules/ai-engine/facade/ai-engine.facade.ts`                           | 506    | 0%     | 严重 |
| 3    | `modules/ai-engine/search/search.service.ts`                             | 423    | 0%     | 严重 |
| 4    | `modules/ai-engine/api/ai-core.controller.ts`                            | 342    | 0%     | 高   |
| 5    | `modules/ai-engine/long-content/services/task-granularity.service.ts`    | 302    | 0%     | 高   |
| 6    | `modules/ai-engine/skills/api/skills-api.service.ts`                     | 249    | 0%     | 高   |
| 7    | `modules/ai-engine/orchestration/services/iteration-manager.service.ts`  | 221    | 0%     | 高   |
| 8    | `modules/ai-engine/skills/loader/skill-loader.service.ts`                | 217    | 0%     | 高   |
| 9    | `modules/ai-engine/observability/cost-attribution.service.ts`            | 208    | 0%     | 高   |
| 10   | `modules/ai-engine/tools/categories/processing/data-cleaning.tool.ts`    | 201    | 0%     | 中   |
| 11   | `modules/ai-engine/tools/categories/processing/file-conversion.tool.ts`  | 201    | 0%     | 中   |
| 12   | `modules/ai-engine/capabilities/ai-capability-resolver.service.ts`       | 196    | 0%     | 高   |
| 13   | `modules/ai-engine/tools/categories/processing/file-parser.tool.ts`      | 192    | 0%     | 中   |
| 14   | `modules/ai-engine/orchestration/services/task-decomposer.service.ts`    | 189    | 0%     | 高   |
| 15   | `modules/ai-engine/orchestration/executors/function-calling-executor.ts` | 183    | 0%     | 高   |
| 16   | `modules/ai-engine/content-analysis/content-analysis.service.ts`         | 182    | 0%     | 高   |
| 17   | `modules/ai-engine/teams/base/workflow.ts`                               | 182    | 0%     | 严重 |
| 18   | `modules/ai-engine/realtime/services/progress-tracker.service.ts`        | 178    | 0%     | 中   |
| 19   | `modules/ai-engine/long-content/services/quality-monitor.service.ts`     | 170    | 0%     | 高   |
| 20   | `modules/ai-engine/collaboration/review/review-workflow.service.ts`      | 169    | 0%     | 高   |

**注意**: 所有进入 TOP 20 的文件均来自 ai-engine，这是因为现有的 coverage 配置仅跟踪了 ai-engine 模块。ai-app 层的所有服务（包括 writing-mission.service.ts, research-mission.service.ts 等高变更率的核心业务文件）完全不在覆盖率统计中。

### 2.3 测试质量 vs 测试缺失 分类

**A. 有测试文件但覆盖率极低（测试质量问题）**:

| 文件                                                | 覆盖率             | 问题分析                     |
| --------------------------------------------------- | ------------------ | ---------------------------- |
| `llm/services/ai-stream-handler.service.ts`         | 5.6% (4/71 stmts)  | 有测试但大量分支未覆盖       |
| `llm/services/ai-image-generation.service.ts`       | 5.6% (5/89 stmts)  | 测试仅覆盖初始化路径         |
| `llm/services/task-profile.types-mapper.service.ts`       | 5.5% (3/54 stmts)  | 映射逻辑几乎未测             |
| `observability/trace-collector.service.ts`          | 4.7% (6/128 stmts) | 关键 trace 创建/关闭逻辑未测 |
| `orchestration/services/circuit-breaker.service.ts` | 2.1% (5/234 stmts) | 熔断逻辑（状态转换）未测     |

**B. 完全无测试（测试缺失问题）**:

- `ai-engine/teams/orchestrator/mission-orchestrator.ts`（648 stmts）
- `ai-engine/facade/ai-engine.facade.ts`（506 stmts）—— 核心入口完全无测试
- 全部 ai-app/\*\* 服务文件

**C. 覆盖率相对充分的文件（仅 3 个）**:

| 文件                                      | 覆盖率                |
| ----------------------------------------- | --------------------- |
| `llm/services/ai-chat.service.ts`         | 77.0% (319/414 stmts) |
| `llm/services/ai-direct-key.service.ts`   | 66.4% (219/330 stmts) |
| `llm/services/ai-model-config.service.ts` | 60.3% (176/292 stmts) |

这三个文件是整个 ai-engine 的 LLM 核心，测试质量是全项目最好的。说明 LLM 调用层已有规范化测试，但其他所有层（编排、Agent、Teams、Skills、工具）均缺失。

### 2.4 ai-engine vs ai-app 覆盖率对比

| 层        | 被跟踪文件数 | 有覆盖文件数 | 平均覆盖率（估算） |
| --------- | ------------ | ------------ | ------------------ |
| ai-engine | 226          | 18 (8%)      | ~3.77%（全局总数） |
| ai-app    | 0            | 0 (0%)       | **完全未跟踪**     |

**根因**: `coverage-summary.json` 中所有文件路径均以 `modules/ai-engine/` 或 `common/` 开头，**没有任何** `modules/ai-app/` 路径。这说明 Jest 覆盖率配置仅收集了 ai-engine 的测试运行数据，ai-app 模块的测试（如 `teams/services/collaboration/mission/__tests__/team-mission.service.spec.ts`）存在但未被纳入覆盖率报告。

这是一个**配置问题**（Jest `collectCoverageFrom` 范围不足），同时也反映出 ai-app 测试本身是分散孤立的，尚未形成系统化的测试套件。

---

## 三、AIEngineFacade 质量评估

### 3.1 公开方法统计与 ISP 评估

**文件**: `backend/src/modules/ai-engine/facade/ai-engine.facade.ts`（2920 行）

通过 Grep 实际统计 `async` public 方法和 getter：

| 类别                                   | 方法/Getter 数量 |
| -------------------------------------- | ---------------- |
| Public async 方法                      | 42 个            |
| Public getter 属性（返回内部服务实例） | 37 个            |
| Private helper 方法                    | 约 15 个         |
| **合计公开 API 表面**                  | **79 个**        |

**ISP 评估**: 接口隔离原则要求接口应该被分解为细粒度的特定客户端接口。79 个公开成员意味着：

- Research 模块使用 `chat()`, `search()`, `buildContext()`, `storeMemory()` — 约 8 个方法
- Writing 模块使用 `chat()`, `chatStructured()`, `executeSkill()`, `longContentEngine`（getter）— 约 10 个方法
- Social 模块使用 `chat()`, `mcpManager`（getter）— 约 3-5 个方法

每个模块实际使用的方法只占全部表面的 5-15%，但每个模块都负担了完整的 79 个公开成员。这是 ISP 的典型违反。

**严重问题 — Getter 退化为 ServiceLocator**:

```typescript
// 以下 getter 将引擎内部服务直接暴露，违反封装
get mcpManager(): MCPManager | undefined
get circuitBreaker(): CircuitBreakerService | undefined
get agentExecutor(): AgentExecutorService | undefined
get taskDecomposer(): TaskDecomposerService | undefined
get intentDetector(): IntentDetectionService | undefined
get execStateManager(): ExecutionStateManager | undefined
get functionCallingAdapter(): FunctionCallingLLMAdapter | undefined
get functionCallingExecutor(): FunctionCallingExecutor | undefined
get modelFallback(): ModelFallbackService | undefined
get teams(): TeamsService | undefined
get contextInit(): ContextInitializationService | undefined
get teamFactory(): TeamFactory | undefined
get longContentEngine(): LongContentEngineService | undefined
// ... 共 37 个
```

这些 getter 的存在让 `AIEngineFacade` 实质上成为了 **ServiceLocator** 模式，而非 Facade 模式。Facade 应该隐藏内部细节，但 37 个 getter 将所有内部服务直接暴漏，AI App 层通过 `facade.mcpManager` 等方式直接访问引擎服务，等效于绕过了 Facade。

### 3.2 依赖注入复杂度

**Constructor 参数总数**: 43 个（6 Feature Token + 37 @Optional 服务）

```
核心必需：2 个（AiChatService, AiModelConfigService）
Feature Tokens：6 个（已分组，是好的改进）
@Optional 独立服务：37 个（过多）
```

**与行业基准对比**:

- NestJS 最佳实践：Constructor 参数 <= 7 个
- 有经验的架构：通过 Feature Module 分组，降至 4-8 个注入点
- 当前 Facade：43 个参数，即使有 Feature Token 分组也无法掩盖复杂性

**关键矛盾**: 引入了 6 个 Feature Token 做分组（是好的设计思路），但之后又添加了 37 个直接 @Optional 注入，抵消了分组的价值。Feature Token 分组和直接注入两种方式并存，设计不一致。

### 3.3 Sub-Facade 拆分评估

**已有 Sub-Facade**（路径：`backend/src/modules/ai-engine/facade/sub-facades/`）:

- `ModelSubFacade` — 模型选择和配置查询
- `TeamSubFacade` — 团队任务执行
- `MemorySubFacade` — 记忆读写
- `AgentSubFacade` — Agent 执行
- `ToolExecSubFacade` — 工具执行

**问题**: 这 5 个 Sub-Facade 是 **plain class（非 @Injectable）**，在 AIEngineFacade 的 constructor 中通过 `new` 实例化，仍然统一注入到 AIEngineFacade。这意味着：

1. Sub-Facade 不是 NestJS DI 体系的一部分，无法被独立注入
2. AI App 仍然必须注入整个 `AIEngineFacade`（所有 43 个依赖）
3. Sub-Facade 只是代码组织层面的拆分，不是架构层面的分离

**改进方向**: Sub-Facade 应该升级为 `@Injectable()` 服务，并由 `AiEngineModule` 作为独立 provider 导出。AI App 可以只注入自己需要的 Sub-Facade（如 `ModelFacade` 或 `MemoryFacade`），而不是整个 `AIEngineFacade`。

### 3.4 改进建议

将当前的 `AIEngineFacade` 拆分为 3-5 个 `@Injectable` Facade：

```
LLMFacade     — chat(), chatStructured(), selectModel(), 模型查询（约 15 个方法）
MemoryFacade  — storeMemory(), retrieveMemory(), sessionMemory*（7 个方法）
AgentFacade   — executeAgent(), executeTool(), startTeamMission()（5 个方法）
SkillFacade   — executeSkill(), chatWithSkills(), capabilityResolveTools()（5 个方法）
RAGFacade     — embeddingGenerate(), vectorSimilaritySearch(), search()（5 个方法）
```

Registry 类（AgentRegistry, TeamRegistry 等）已经可以被独立注入（从 facade/index.ts 导出），这个方向是正确的，应该把这一模式推广到其他服务能力。

---

## 四、AI Evolution 演进对齐度

### 4.1 "复用现有"服务存在性验证

**来源**: `docs/architecture/platform-evolution/ai-evolution-system-design.md`

| 演进文档声称"已有"      | 实际文件路径                                                 | 验证状态 | 接口兼容性                                                                                                           |
| ----------------------- | ------------------------------------------------------------ | -------- | -------------------------------------------------------------------------------------------------------------------- |
| `TraceCollectorService` | `modules/ai-engine/observability/trace-collector.service.ts` | 存在     | 已有 CreateTraceInput/SpanInput/EndTraceInput 接口，与 TaskExecution.traceId 字段对应，兼容                          |
| `EvalPipelineService`   | `modules/ai-engine/observability/eval-pipeline.service.ts`   | 存在     | 已有 EvalResult（structuralScore, judgeScore, dimensions），与 ExecutionFeedback.evalScore/judgeScore 字段对应，兼容 |
| `QualityGateService`    | `modules/ai-engine/quality/services/quality-gate.service.ts` | 存在     | 已有 registerChecker/check 接口，但位于 quality 模块，与 evolution 文档中的 "OutputReviewerService" 用途有重叠       |
| `StreamingService`      | `common/streaming/streaming.service.ts`                      | 存在     | 可用于 ClaudeCodeGatewayService 的 stdout 转发，兼容                                                                 |

**额外发现**: 演进文档提到的 `EvalPipelineService` 已经在 `AiEngineModule` 中注册为 provider（`ai-engine.module.ts` 第 177 行）。文档中 `ExecutionFeedback.evalScore / structuralScore / judgeScore` 字段直接对应 `EvalResult` 的输出结构，接口层是兼容的。

### 4.2 演进路径障碍识别

**障碍 1: evolution 模块不存在**

演进文档的目标路径 `backend/src/modules/ai-engine/evolution/` 中**没有任何文件**（Glob 搜索返回 0 结果）。整个 Evolution 功能尚未开始实现：

- `ClaudeCodeGatewayService` — 不存在
- `FeedbackAggregatorService` — 不存在
- `PatternAnalysisService` — 不存在
- `ProposalGeneratorService` — 不存在
- `SafetyClassifierService` — 不存在
- `EvolutionApplyService` — 不存在

**障碍 2: 数据库模型不存在**

演进文档定义了 5 个新 Prisma 模型（`TaskExecution`, `ExecutionFeedback`, `EvolutionProposal`, `EvolutionAbTest`, `ConfigSnapshot`），目前均未在 schema 中创建。

**障碍 3: Facade 过于臃肿可能阻碍演进集成**

演进系统需要通过 Facade 接入 TraceCollector 和 EvalPipeline 获取执行数据。当前 Facade 已经有 `TraceCollectorService` 作为 @Optional 注入，但 `EvalPipelineService` **未暴露**在 Facade 的公开接口中，也没有对应的 getter。如果 Evolution 模块需要触发评估，必须先扩展 Facade（但 Facade 已经过载）。

**障碍 4: QualityGate vs OutputReviewer 职责重叠**

演进文档将 `QualityGateService` 用于"输出质量门控"，但 Facade 中已有 `get outputReviewer()` getter（指向 `OutputReviewerService`）。两者的职责边界不清晰，实施演进功能时需要先理清。

### 4.3 当前架构对演进的支撑评分

| 演进能力维度               | 评分       | 说明                                                 |
| -------------------------- | ---------- | ---------------------------------------------------- |
| Trace 采集基础设施         | 85/100     | TraceCollectorService 设计完善，已集成到 Facade      |
| 质量评估层（EvalPipeline） | 70/100     | 三层架构设计合理，已部分覆盖（但仅 4.7% 测试覆盖率） |
| 流式输出能力               | 90/100     | StreamingService 已有完整实现（4 个文件）            |
| Claude Code CLI 集成接口   | 0/100      | 未实现，需要从零开始                                 |
| 数据库演进模型             | 0/100      | 5 个新 Prisma 模型均未创建                           |
| 提案生成/安全分级          | 0/100      | 完全未开始                                           |
| **整体演进就绪度**         | **40/100** | 基础设施较好，但实施层面几乎空白                     |

---

## 五、架构扩展性热点

### 5.1 高变更频率文件 TOP 20（2026-01-01 至今，共 1035 次提交）

| 排名 | 文件                                                                   | 变更次数 | 性质                                     |
| ---- | ---------------------------------------------------------------------- | -------- | ---------------------------------------- |
| 1    | `ai-app/writing/services/mission/writing-mission.service.ts`           | 119      | 业务逻辑热点，高度不稳定                 |
| 2    | `ai-engine/llm/services/ai-chat.service.ts`                            | 66       | 核心基础设施，变更频繁                   |
| 3    | `ai-app/research/topic-research/services/research-mission.service.ts`  | 66       | 业务逻辑热点                             |
| 4    | `ai-engine/facade/ai-engine.facade.ts`                                 | 56       | Facade 是所有变更的汇聚点                |
| 5    | `ai-app/research/topic-research/services/research-leader.service.ts`   | 46       | 研究编排逻辑不稳定                       |
| 6    | `ai-engine/ai-engine.module.ts`                                        | 44       | 模块配置频繁变动                         |
| 7    | `ai-app/research/topic-research/topic-research.service.ts`             | 44       | 研究核心服务                             |
| 8    | `ai-app/research/topic-research/services/dimension-mission.service.ts` | 42       | 研究子任务逻辑                           |
| 9    | `ai-app/research/topic-research/services/report-synthesis.service.ts`  | 38       | 报告合成逻辑                             |
| 10   | `ai-app/teams/services/collaboration/team-mission.service.ts`          | 35       | Teams 核心协作路径                       |
| 11   | `ai-app/teams/services/collaboration/mission/team-mission.service.ts`  | 35       | 同上（有路径重复，可能是重构过渡期产物） |
| 12   | `ai-app/social/adapters/wechat.adapter.ts`                             | 33       | Social 适配层变化频繁                    |
| 13   | `ai-app/office/slides/services/slides-engine.service.ts`               | 33       | Slides 引擎不稳定                        |
| 14   | `ai-app/writing/ai-writing.module.ts`                                  | 32       | 模块配置高频变动（臃肿的直接结果）       |
| 15   | `ai-app/research/topic-research/topic-research.controller.ts`          | 31       | 控制器不稳定（API 接口尚未固化）         |
| 16   | `ai-app/writing/ai-writing.controller.ts`                              | 27       | 同上                                     |
| 17   | `ai-app/research/topic-research/topic-research.module.ts`              | 26       | 模块配置高频变动                         |
| 18   | `core/admin/admin.controller.ts`                                       | 25       | Admin 控制器持续扩展                     |
| 19   | `ai-app/research/topic-research/prompts/dimension-research.prompt.ts`  | 23       | Prompt 工程频繁迭代                      |
| 20   | `ai-engine/search/search.service.ts`                                   | 22       | 搜索服务持续演进                         |

**重要发现**: `team-mission.service.ts` 在两个不同路径下都出现（排名 10 和 11），变更次数相近，这是**文件重复**或**重构过渡期残留**的信号，需要清理。

### 5.2 高风险重构区域

**区域 A: Writing Mission（最高风险）**

`writing-mission.service.ts`（119次变更）是全项目变更最频繁的文件，同时：

- 所在模块 `AiWritingModule` 有 50+ providers（耦合度最高）
- 测试覆盖率：0%（ai-app 全部未覆盖）
- 功能：协调 5 个 AI Agents 完成长文写作任务

三重危险叠加：**高频变更 + 零测试 + 高耦合**，任何修改都在没有安全网的情况下影响大范围代码。

**区域 B: Facade（系统性风险）**

`ai-engine.facade.ts`（56次变更）是所有 AI App 的单一入口。每次 App 层需要新能力，都会修改 Facade（添加方法或 getter），使其持续膨胀。这是一个**正反馈的失控螺旋**：Facade 越大 → 每次修改影响范围越广 → 越难修改 → 修改越频繁。

**区域 C: Research 编排层（中风险）**

`research-mission.service.ts`（66次）+ `research-leader.service.ts`（46次）+ `topic-research.service.ts`（44次）构成了 Research 的核心编排链，三者合计变更 156 次，超过 Facade 的 56 次。说明 Research 的 AI 编排逻辑还在频繁演进，尚未稳定。

### 5.3 建议拆分/稳定化的模块

**优先级 1 - Writing 模块拆分（最迫切）**:

```
AiWritingModule (现有，50+ providers)
  ├── WritingBibleModule       — 故事圣经管理（5 services）
  ├── WritingCoreModule        — 写作执行（9 services）
  ├── WritingMissionModule     — 任务编排 (11 services，高频变更区域)
  ├── WritingConsistencyModule — 一致性检查（8 services）
  ├── WritingQualityModule     — 质量评估（18 services，可进一步独立）
  └── WritingParallelModule    — 并行写作（4 services）
```

**优先级 2 - Facade 分层拆分（架构关键）**:

- 将 5 个 plain class Sub-Facade 升级为 `@Injectable()`
- 拆分为 `LLMFacade`, `MemoryFacade`, `AgentFacade`, `SkillFacade`, `RAGFacade`
- 保留 `AIEngineFacade` 作为向后兼容的组合 Facade，但将其内部实现改为委托给上述子 Facade

**优先级 3 - Teams 模块拆分（中期）**:

```
AiTeamsModule (现有，35 providers)
  ├── TopicModule     — 话题 CRUD（纯数据层，7 services）
  ├── MissionModule   — 任务编排（AI 层，12 services）
  └── DebateModule    — 辩论协作（3 services）
```

---

## 六、综合质量矩阵

| 维度            | 评分       | 主要问题                                                | 根本原因                                  | 优先行动                                       |
| --------------- | ---------- | ------------------------------------------------------- | ----------------------------------------- | ---------------------------------------------- |
| 模块内聚度      | 52/100     | Writing 50+ providers, Facade 2920 行                   | 功能持续叠加，未定期重构                  | 按领域边界拆分 Writing 和 Facade               |
| 模块耦合度      | 55/100     | Office 直接依赖 Research+Writing, Facade 承载所有依赖   | 跨 App 集成走了捷径                       | 引入 DataExchange 中间层或 Event 解耦          |
| 测试覆盖率      | 4/100      | ai-app 零覆盖，ai-engine 3.77%，226 文件中仅 18 有覆盖  | 测试策略缺失，覆盖配置不完整              | 建立分层测试策略，从高风险路径开始             |
| 测试质量        | 30/100     | 3 个文件覆盖率 60%+，其余普遍 < 10%                     | 测试集中在 LLM 层，编排/业务层缺失        | 为 mission orchestrator 和 Facade 添加集成测试 |
| Facade ISP 合规 | 35/100     | 79 个公开成员，37 个 getter 退化为 ServiceLocator       | Facade 被用作 ServiceLocator 而非封装边界 | 拆分为特定能力 Facade，删除非必要 getter       |
| 演进架构就绪度  | 40/100     | evolution 模块不存在，5 个 DB 模型未创建                | 设计先于实现，实施差距较大                | 按演进文档逐步实施，优先建 DB 模型             |
| 架构稳定性      | 45/100     | 高频变更文件集中在业务逻辑层（写作 119 次，研究 66 次） | 业务逻辑尚未稳定，测试缺失放大风险        | 先稳定接口，再优化实现                         |
| **综合评分**    | **48/100** |                                                         |                                           |                                                |

---

## 七、路线图建议（按优先级）

### 本迭代（P0 — 测试危机）

**P0.1: 建立 ai-app 测试基线**

- [ ] 将 ai-app 模块纳入 Jest `collectCoverageFrom` 配置
- [ ] 为 `writing-mission.service.ts` 添加至少 10 个关键路径测试（当前 119 次变更，0% 覆盖，最高风险）
- [ ] 为 `team-mission.service.ts` 添加 Mission 生命周期基本测试
- [ ] 目标：ai-app 核心路径覆盖率 >= 30%

**P0.2: 核心引擎覆盖率补齐**

- [ ] `mission-orchestrator.ts`（648 stmts，0%）—— 最大零覆盖文件
- [ ] `ai-engine.facade.ts`（506 stmts，0%）—— 核心入口
- [ ] `circuit-breaker.service.ts`（234 stmts，2.1%）—— 熔断状态转换必须测

### 本迭代（P1 — Facade 架构改进）

**P1.1: Facade Getter 清理**

- [ ] 审查 37 个 getter，删除/降级可通过 Registry 类直接访问的 getter
- [ ] 对确实需要保留的 getter，添加文档说明使用场景限制
- [ ] 建立规则：新功能不再以 getter 形式暴露，而是以方法或独立 Facade

**P1.2: Sub-Facade 升级为 @Injectable**

- [ ] 将 `ModelSubFacade` 升级为 `@Injectable() ModelFacade`
- [ ] 在 `AiEngineModule` 中作为独立 provider 导出
- [ ] Writing 模块改为只注入 `ModelFacade`（而非整个 `AIEngineFacade`），作为验证

### 下季度（P2 — 模块边界重构）

**P2.1: Writing 模块拆分**

- [ ] 抽取 `WritingQualityModule`（18 个质量服务 → 独立模块，最容易隔离）
- [ ] 抽取 `WritingBibleModule`（5 个圣经服务 → 与写作执行无直接依赖）
- [ ] 目标：`AiWritingModule` providers 从 50+ 降至 20 以下

**P2.2: Office 跨 App 依赖解耦**

- [ ] 将 `SlidesDataImportService` 的 Research 数据获取改为 Event-based 或 HTTP API 调用
- [ ] 消除 `AiOfficeModule` 对 `ResearchModule` 和 `AiWritingModule` 的直接 import

**P2.3: 清理重复路径**

- [ ] 调查 `team-mission.service.ts` 在两个路径的重复（35次+35次变更）
- [ ] 确认是文件迁移后的残留，删除废弃路径

### 长期规划（P3 — 演进系统与测试成熟度）

**P3.1: AI Evolution 模块实施**

- [ ] 创建 `backend/prisma/schema/` 中的 5 个 Prisma 模型（TaskExecution 等）
- [ ] 创建 `backend/src/modules/ai-engine/evolution/` 模块骨架
- [ ] 实现 `ClaudeCodeGatewayService`（spawn Claude CLI，worktree 隔离）
- [ ] 将 `EvalPipelineService` 通过 Facade 暴露给 Evolution 模块

**P3.2: 测试成熟度目标**

- [ ] 短期目标（Q1）：ai-engine 核心路径 >= 40%，ai-app 核心路径 >= 30%
- [ ] 中期目标（Q2）：全项目 statements >= 50%，branches >= 40%
- [ ] 考虑引入 Contract Testing 替代 AI Service 的 E2E 测试

**P3.3: 架构守护自动化**

- [ ] 将 `arch-guardian` 纳入 pre-commit hook
- [ ] 在 CI 中添加 Facade 公开方法数量的自动统计和阈值告警（超过 50 个方法时发出警告）
- [ ] 月度架构审计与健康评分趋势跟踪（利用 `docs/audits/` 历史数据）

---

## 附录：数据来源说明

| 结论                                  | 数据来源文件                                                             |
| ------------------------------------- | ------------------------------------------------------------------------ |
| Facade 方法数（42 async + 37 getter） | `backend/src/modules/ai-engine/facade/ai-engine.facade.ts` 全文 Grep     |
| Facade constructor 参数数（43个）     | 同上，第 243-324 行                                                      |
| Writing 模块 50+ providers            | `backend/src/modules/ai-app/writing/ai-writing.module.ts` 第 114-205 行  |
| Teams 模块 35 providers               | `backend/src/modules/ai-app/teams/ai-teams.module.ts` 第 85-133 行       |
| 覆盖率全部数据                        | `backend/coverage/coverage-summary.json`（执行 Node.js 解析脚本）        |
| 变更频率 TOP 20                       | `git log --oneline --name-only --since="2026-01-01"` + sort + uniq -c    |
| Evolution 文档                        | `docs/architecture/platform-evolution/ai-evolution-system-design.md`     |
| EvalPipelineService 存在性            | `backend/src/modules/ai-engine/observability/eval-pipeline.service.ts`   |
| QualityGateService 存在性             | `backend/src/modules/ai-engine/quality/services/quality-gate.service.ts` |
| StreamingService 存在性               | `backend/src/common/streaming/streaming.service.ts`                      |
| evolution 模块不存在                  | Glob: `backend/src/modules/ai-engine/evolution/**/*.ts` → 0 results      |
| Office 跨 App 依赖                    | `backend/src/modules/ai-app/office/ai-office.module.ts` imports 字段     |
| Sub-Facade 列表                       | `backend/src/modules/ai-engine/facade/sub-facades/` 目录结构             |

---

_评估完成时间: 2026-02-24_
_下次建议评估时间: 2026-03-24_
_工具: Arch Auditor Agent v1.0_

