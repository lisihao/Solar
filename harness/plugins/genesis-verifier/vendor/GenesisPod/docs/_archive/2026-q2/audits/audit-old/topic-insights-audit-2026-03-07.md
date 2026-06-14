# Topic Insights 模块架构审计报告

**审计日期**: 2026-03-07
**审计范围**: `backend/src/modules/ai-app/topic-insights/`（及直接依赖）
**审计员**: Arch Auditor Agent v2.0
**代码规模**:

- 生产文件: 156 个 TS 文件，72,501 行代码
- 测试文件: 101 个 spec 文件
- 测试比: 101 / 156 = **64.7%**（极高，行业领先）

---

## 执行摘要

| #   | 维度           | 满分    | 得分    | 状态             |
| --- | -------------- | ------- | ------- | ---------------- |
| 1   | 模块结构与分层 | 10      | 9       | 优秀             |
| 2   | 依赖管理       | 10      | 9       | 优秀             |
| 3   | API 设计       | 10      | 8       | 良好             |
| 4   | 服务层设计     | 10      | 7       | 良好（残留问题） |
| 5   | 类型系统       | 10      | 8       | 良好             |
| 6   | 研究流程架构   | 10      | 9       | 优秀             |
| 7   | 数据流设计     | 10      | 8       | 良好             |
| 8   | 质量保障       | 10      | 9       | 优秀             |
| 9   | 可观测性       | 10      | 8       | 良好             |
| 10  | 安全性         | 10      | 9       | 优秀             |
| 11  | 可扩展性       | 10      | 8       | 良好             |
| 12  | 代码质量       | 10      | 8       | 良好             |
|     | **总分**       | **120** | **100** | **良好**         |

**综合评价**: 模块整体架构质量达到企业级标准，在 Facade 边界、安全防护、测试覆盖三个维度表现突出。主要剩余债务集中在：God Service 拆分不彻底（残留 `topic-insights.service.ts` 23条直接 DB 调用）、`throw new Error` 使用（76处非 NestJS 标准异常）、`RAGFusionService` 未注册为 Module Provider 形成死代码。

---

## D1: 模块结构与分层 [9/10]

### 目录结构分析

```
topic-insights/
├── agents/           -- Agent 定义
├── config/           -- 数据源映射、维度模板配置
├── constants/        -- Agent 角色常量
├── controllers/      -- 6 个 Controller（含 __tests__/）
├── dto/              -- 15+ DTO 文件（完整）
├── guards/           -- TopicAccessGuard（RBAC）
├── prompts/          -- 6 个 Prompt 模板
├── services/
│   ├── collaboration/ -- 6 个协作服务
│   ├── core/          -- 20 个核心服务
│   ├── data/          -- 12 个数据服务（含 connectors/）
│   ├── dimension/     -- 4 个维度服务
│   ├── monitoring/    -- 4 个监控服务
│   ├── quality/       -- 4 个质量服务
│   ├── report/        -- 9 个报告服务
│   └── verification/  -- 2 个验证服务
├── skills/            -- 35 个 Skill Markdown 文件
├── teams/             -- Team 配置
├── types/             -- 20+ 类型定义文件
└── utils/             -- 5 个工具函数
```

**亮点**:

- 分层极为清晰，按关注点（core / data / dimension / report / quality / monitoring / collaboration / verification）正交划分
- 每个子层都有独立的 `index.ts` 统一导出，控制内部可见性
- `skills/` 目录的 35 个 Markdown skill 文件体现了 Skill-as-Code 理念，配合 `PromptSkillBridge` 实现了 skill 注册自动化
- `config/` 将维度模板和数据源映射外置为配置驱动，不混入业务逻辑

**发现**:

- [Minor] `topic-insights.service.ts`（1609行）定位为 Facade，但仍包含 `cleanHtmlTagsFromContent()` 私有工具函数，应移至 `utils/`
- [Minor] `__tests__/` 目录（根级）与各子层的 `__tests__/` 并存，测试文件位置略不一致

**扣分**: -1（Facade 服务残留工具函数，轻微职责混乱）

---

## D2: 依赖管理 [9/10]

### Facade 边界检查

```bash
# 全量扫描: from '@/.../ai-engine' 非 facade 路径
结果: 0 违规（生产文件）
```

所有对 `ai-engine` 内部符号的访问均通过 `@/modules/ai-engine/facade` 导入：

- `ChatFacade`, `AgentFacade`, `ToolFacade`, `TeamFacade`, `RAGFacade`, `ChatFacade`
- `GuardrailsPipelineService`, `PromptSkillBridge`, `AgentRegistry`, `TeamRegistry` 等

**唯一例外**（合规）:

```typescript
// data-source-fetcher.service.ts:940
): import("@/modules/ai-engine/facade").ToolContext {
```

这是返回类型标注的内联 `import type`，等价于顶层 `import type { ToolContext } from '@/modules/ai-engine/facade'`，属于 Facade 访问，不违规。

**module.ts 导入审查**:

```typescript
import { AiEngineModule } from "../../ai-engine/ai-engine.module";
```

这是模块级 `imports: [AiEngineModule]`，属于 NestJS 模块依赖声明（正确模式），不是符号级 Facade 绕过。

**ai-kernel/facade 访问**:

```typescript
import {
  CircuitBreakerService,
  TaskCompletionType,
  CapabilityGuardService,
} from "@/modules/ai-kernel/facade";
import { KernelContext, MessageBusService } from "@/modules/ai-kernel/facade";
```

通过 ai-kernel/facade 访问，符合架构层级（ai-app → ai-kernel 是合法向下依赖）。

**ai-infra/facade 访问**:

```typescript
import { BillingContext } from "@/modules/ai-infra/facade";
```

合规。

**发现**:

- [Minor] `RAGFusionService` 在 `services/data/rag-fusion.service.ts` 中定义，但未在 `services/index.ts` 导出，也未注册为 Module Provider，形成**死代码**（功能未激活）

**扣分**: -1（RAGFusionService 死代码，依赖管理不完整）

---

## D3: API 设计 [8/10]

### Controller 覆盖

6 个 Controller，全部有对应 spec 文件（位于 `controllers/__tests__/`，非传统同目录 spec）：

- `TopicController` -- Topic CRUD, refresh, SSE, dimensions, templates, schedule, logs
- `MissionController` -- Leader planning, mission lifecycle, health check, resume
- `ReportController` -- Report CRUD, AI editing, evidence, annotations
- `ReportReviewController` -- Review workflow
- `CollaborationController` -- Collaborators, shared access
- `TodoController` -- TODO management

**亮点**:

- 全局 `@UseGuards(JwtAuthGuard)` 在 Controller 级别统一应用
- 敏感操作（AI 密集型）有 `@Throttle({ default: { limit: 10, ttl: 60000 } })`
- 资源操作有 `@UseGuards(TopicAccessGuard)` + `@RequireTopicAccess(CollaboratorRole.EDITOR/VIEWER)` 的细粒度 RBAC
- 完整的 Swagger 注解：`@ApiTags`, `@ApiBearerAuth`, `@ApiOperation`, `@ApiParam`, `@ApiQuery`, `@ApiResponse`
- 公开端点明确标注 `@Public()` + `@Throttle()` 防滥用

**发现**:

- [Major] `MissionController.leaderMessage()` 和 `getMission()` 等多个端点**缺少** `@UseGuards(TopicAccessGuard)`，改用手动 `if (!userId) throw UnauthorizedException` 检查，访问控制不一致（topic 所有权无法验证）
  ```typescript
  // 缺少 TopicAccessGuard，只校验登录态，不校验 topic 归属
  async leaderMessage(@Request() req, @Param("id") id: string, ...)
  async getMission(@Request() req, @Param("id") id: string)
  ```
- [Minor] `TopicController` 部分 GET 端点（`/stats`, `/research-history`）缺少 `@Throttle` 防刷
- [Minor] `leaderChat` 的 `@Body() dto` 使用内联类型 `{ message: string; missionId?: string }` 而非专用 DTO，无法应用 `class-validator` 装饰器

**扣分**: -2（TopicAccessGuard 覆盖缺口 -1，DTO 不完整 -1）

---

## D4: 服务层设计 [7/10]

### 服务数量与规模

| 服务文件                             | 行数 | 评估                           |
| ------------------------------------ | ---- | ------------------------------ |
| `research-mission.service.ts`        | 3826 | 超大，仍是 God Service         |
| `research-leader.service.ts`         | 2758 | 超大，拆分不充分               |
| `dimension-mission.service.ts`       | 2475 | 超大                           |
| `report-synthesis.service.ts`        | 2388 | 超大                           |
| `data-source-router.service.ts`      | 2162 | 超大                           |
| `topic-team-orchestrator.service.ts` | 1795 | 大                             |
| `mission-execution.service.ts`       | 1737 | 大                             |
| `research-todo.service.ts`           | 1666 | 大                             |
| `topic-insights.service.ts`          | 1609 | Facade，仍有 23 处直接 DB 调用 |

**亮点**:

- 历史 God Service 已有拆分意识（`ResearchMissionService` → `MissionObservabilityService + MissionKernelBridgeService + MissionNotificationService + MissionQueryService + MissionLifecycleService + MissionExecutionService`，Module 注释标注了拆分进展）
- 各子层 Service 间耦合度低，通过构造器注入
- `TopicInsightsService` 已成功将大部分业务委托给 `TopicCrudService / TopicDimensionService / TopicExportService / TopicScheduleService`

**发现**:

- [Major] `ResearchMissionService`（3826行）仍存在并接收大量注入（14个依赖），与拆分出的 `MissionLifecycleService`（1095行）**职责重叠**：两者都有 `createMission()` 方法（第 161 行 vs 第 61 行），存在逻辑重复
- [Major] `TaskResultJson` 接口在 `research-mission.service.ts`（第66行）和 `mission-execution.service.ts`（第40行）中**重复定义**，应提取到 `types/` 共享
- [Minor] `RAGFusionService` 定义但未注册，功能未激活（见 D2）
- [Minor] `topic-insights.service.ts` 仍有 23 处 `this.prisma.*` 直接调用（AI Edit 报告、证据聚合等），未完全委托给子服务

**扣分**: -3（createMission 重复 -1，TaskResultJson 重复定义 -1，prisma 直接调用残留 -1）

---

## D5: 类型系统 [8/10]

### any 类型使用

生产文件中 `any` 使用量: **0**（grep 结果为 0）

类型系统高度成熟：

- 20+ 专用类型文件（`leader.types.ts`, `mission.types.ts`, `report.types.ts`, `data-source.types.ts` 等）
- 使用 Prisma 生成类型 + 本地接口的混合策略
- `TaskResultJson` 使用 `[key: string]: unknown` 而非 `any` 作为扩展字段（正确做法）
- 广泛使用 `import type` 避免运行时开销

**发现**:

- [Minor] `TaskResultJson` 接口在 2 处重复定义（同 D4），类型一致性风险
- [Minor] `topicConfig?: Record<string, unknown>` 等字段的 JSON 结构未用 TypeScript 类型精确描述，依赖运行时转换
- [Info] `v5-research.types.ts` 文件名中含版本号（违反命名规范），但此为历史遗留

**扣分**: -2（重复类型定义 -1，JSON字段类型精度不足 -1）

---

## D6: 研究流程架构 [9/10]

### 研究生命周期状态机

```
PLANNING → PLAN_READY → EXECUTING → REVIEWING → COMPLETED
                ↓              ↓           ↓
            CANCELLED      CANCELLED    FAILED
                                    ↘
                                    (resume) → EXECUTING
```

**亮点**:

- `PLAN_READY` 状态实现了"规划透明度"——用户可审查 Leader 规划后再批准执行
- `ResearchCheckpointService` 实现断点续传，`canResume()` + `resumeMission()` API 完整
- `MissionExecutionService.startExecution()` 使用任务队列（priority排序）并行执行
- `AdaptivePlanningService` 实现自适应规划，per-mission mutex 防止重入
- `ResearchMissionHealthService` 实现 Watchdog（5分钟超时检测卡死任务）
- `ResearchMemoryService` 实现跨研究的记忆层（learning_insight, fact, context 三层）

**发现**:

- [Minor] `ResearchMissionStatus` 状态缺少 `REVIEWING` 到 `COMPLETED` 的细粒度中间态，报告生成过程对用户透明度不足
- [Info] `v5-research.types.ts` 的研究深度（quick / standard / deep / exhaustive）配置驱动良好

**扣分**: -1（报告生成阶段透明度不足）

---

## D7: 数据流设计 [8/10]

### 数据源策略

`DataSourceRouterService`（2162行）实现了完整的数据源路由：

- 通过 `ToolRegistry` 调用工具（`FederalRegisterTool`, `CongressGovTool`, `WhiteHouseNewsTool`）
- 通过 `RAGFacade` 进行向量检索
- 通过 `DataSourceConnectorRegistry` 管理外部 API 连接器（`SemanticScholar`, `PubMed`, `FinanceApi`, `WeatherApi`）
- `DataSourcePlannerService` 使用 AI 进行数据源规划
- `LruMap` 防止缓存无限增长

### Evidence 管理

`EvidenceManagementService` + `EvidenceSyncCompensationService` 组合实现了：

- Evidence CRUD 和查询
- 同步补偿机制（异常恢复）

### 报告生成流程

```
DimensionMission → SectionWriter → ReportAssembler → ReportSynthesis → ReportQualityGate
                                                          ↓
                                              CitationFormatter + FigureExtractor
```

**发现**:

- [Major] `RAGFusionService` 定义了完整的 RAG Fusion 逻辑（多路召回 + 倒排排名），但**未注册为 Provider**，整条 RAG Fusion 数据路径处于死代码状态
- [Minor] `DataSourceRouterService` 2162行，承担了路由、缓存、多源并发、去重、评分多个职责，建议进一步拆分
- [Minor] 知识图谱 (`KnowledgeGraphService`) 功能已实现但与主研究流程的集成点不清晰

**扣分**: -2（RAGFusion 死代码路径 -1，DataSourceRouter 职责过重 -1）

---

## D8: 质量保障 [9/10]

### 测试覆盖分析

| 维度                 | 数值                                      |
| -------------------- | ----------------------------------------- |
| 生产文件数           | 156                                       |
| 测试文件数           | 101                                       |
| 测试比               | 64.7%                                     |
| Controller spec 覆盖 | 6/6 = 100%（在 `controllers/__tests__/`） |

**亮点**:

- 测试文件数量和质量均属行业领先水平
- 每个核心服务均有对应 spec，关键服务有多个 supplemental spec（`research-mission.service-supplemental[2-4].spec.ts`）
- `__tests__/unit/` 包含针对 Gateway、Orchestrator、V5 数据源路由等系统级测试
- `prompt-sanitizer.spec.ts` 验证安全过滤逻辑

### 验证管道

`ReportQualityGateService`:

- 标题层级检查（heading_hierarchy）
- 粗体格式限制（bold_overuse）
- 引用块限制（blockquote_count）
- 外语块检测（foreign_language）
- 引用去重（deduplication）
- 自动修复 + 人工审核指导（rewriteGuidance）

`CritiqueRefineService`:

- Critique-then-Refine 两轮质量提升

`SelfConsistencyService`:

- 多路推理路径聚合（Wang et al., 2022）

**发现**:

- [Minor] `critique-refine.service.spec.ts` 中使用了硬编码模型名（`model: "gpt-4"`），测试 mock 数据不符合规范（但不影响生产）
- [Info] `ClaimVerificationService` 和 `SelfConsistencyService` 功能实现完整，但与主研究流程的触发条件不明确

**扣分**: -1（测试 mock 中硬编码模型名）

---

## D9: 可观测性 [8/10]

### Logger 使用

61个 `.service.ts` 文件中，61个有 `Logger` 实例（100%覆盖率）。

**亮点**:

- 所有 Service 和 Gateway 均有 `private readonly logger = new Logger(ClassName.name)`
- `SecurityAuditLogger` 独立模块，记录 AUTH_SUCCESS/AUTH_FAILURE/TOKEN_INVALID/PROMPT_INJECTION 等安全事件
- `MissionObservabilityService` 专门负责 Mission 可观测性指标
- `ResearchCheckpointService` 实现完整的 checkpoint 保存/恢复机制
- `AgentActivityService` 记录 Agent 每步行为（thinking / tool_use / result）

### WebSocket 可观测性

`TopicInsightsGateway` 的 `sync:request` handler 返回结构化的 `SyncResponse`，包含 `needsRecovery` 标志，支持客户端主动状态同步。

**发现**:

- [Minor] `ResearchMissionService` 有 `missionTraces` Map 用于 trace 状态，但与 `ai-engine/observability/trace-collector.service.ts` 的集成依赖 `ai-kernel` 而非直接接入 trace 系统，链路不完整
- [Minor] 超大服务（3826行）中的日志散布在大量方法中，难以从日志快速定位问题区域

**扣分**: -2（Trace 链路不完整 -1，超大文件降低可调试性 -1）

---

## D10: 安全性 [9/10]

### 提示注入防护

`PromptSanitizer`（`utils/prompt-sanitizer.ts`）:

- 14 类危险模式检测（指令覆盖、角色劫持、系统角色伪装、提示泄露、DAN mode 等）
- 隐藏 Unicode 字符过滤（零宽字符、控制字符等 8 类范围）
- 输入长度限制（默认 10000 字符）
- 安全审计日志集成

`GuardrailsPipeline` 集成（通过 `@Optional()` 注入，`GUARDRAILS_ENABLED` 控制）。

### WebSocket 认证

`TopicInsightsGateway`:

- Socket.IO 中间件级 JWT 验证（连接阶段即拒绝）
- 每用户最多 5 个并发连接（旧连接被驱逐）
- `join:topic` 验证 topic 所有权
- `SecurityAuditLogger` 记录认证事件

### CORS 策略

Gateway 使用函数式 CORS：

- localhost：允许任意端口（开发）
- Railway：`endsWith(".railway.app")` 精确域名后缀匹配（正确，防止子域名绕过）

**发现**:

- [Major] Gateway CORS 的 `isRailway` 条件使用 `endsWith(".railway.app")`，这允许任何 `*.railway.app` 子域名访问 WebSocket，若攻击者在 Railway 上部署恶意服务，可绕过 CORS。应使用具体的应用域名或从 `CORS_ORIGINS` 环境变量读取
- [Minor] `prompt-sanitizer.ts` 的模式匹配主要针对英文 prompt injection，缺少中文 prompt injection 模式（如"忽略以上所有指示"）

**扣分**: -1（CORS 过于宽泛 -1）

---

## D11: 可扩展性 [8/10]

### 策略模式应用

`DataSourceConnectorRegistry` + 连接器接口实现了策略/插件化：

```typescript
// 新增数据源只需实现接口并调用 register()
connectorRegistry.register(this.semanticScholarConnector);
connectorRegistry.register(this.pubMedConnector);
```

`ToolRegistry` 调用工具（`FederalRegisterTool`, `CongressGovTool` 等）体现了工具插件化。

### 配置驱动

- `config/dimension-templates.config.ts`：维度模板配置化
- `config/data-source-mapping.config.ts`：数据源→工具映射配置化
- `v5-research.types.ts` 的 `resolveResearchDepthConfig()`：研究深度配置化
- `ANALYSIS_SKILL_DEFINITIONS` 在 `leader.types.ts` 中集中定义

### 35个 Skill Markdown 文件

涵盖：cause-effect, claim-extraction, comparison, competitive-analysis, consistency-check, content-critique, content-refine, critical-thinking, data-interpretation, debate-\*, deep-dive, dimension-research/review/synthesizer, entity-extraction, fact-check/verification, future-projection, hypothesis-verification, multi-path-reasoning, multi-view-synthesizer, plan-adjuster, rag-fusion-query, report-editing/synthesis, research-planning, section-review, specialized-role-analysis, swot-analysis, synthesis, task-quality-evaluator, trend-analysis

**发现**:

- [Minor] `ResearchLeaderService.planResearch()` 硬编码了"为 Agent 分配模型"的逻辑在 2758 行服务中，Agent 分配策略不易扩展
- [Minor] 新增数据源连接器类型需要修改 `data-source-mapping.config.ts`，配置与代码耦合度还可降低

**扣分**: -2（Leader 规划策略硬编码 -1，数据源类型扩展需改配置 -1）

---

## D12: 代码质量 [8/10]

### 命名规范

- 文件：全部 kebab-case（符合规范）
- 类/接口：PascalCase（符合规范）
- 方法/变量：camelCase（符合规范）
- 无 emoji（符合规范）
- 无 `console.log`（0处，全部使用 Logger）
- 无 `@ts-ignore`（0处）
- 无 `@ts-expect-error`（0处）

### 代码重复

- `TaskResultJson` 接口在 `research-mission.service.ts`（第66行）和 `mission-execution.service.ts`（第40行）完全重复（70+ 行）
- `createMission()` 方法在 `ResearchMissionService` 和 `MissionLifecycleService` 中均存在（疑似重构中间态）

### 复杂度

- 最大文件 3826 行（`research-mission.service.ts`）远超 500 行阈值
- 5 个文件超过 2000 行：研究任务、研究Leader、维度任务、报告合成、数据源路由

**发现**:

- [Major] `research-mission.service.ts` 3826 行，`research-leader.service.ts` 2758 行，两者均为超大文件，维护风险极高
- [Major] `TaskResultJson` 接口重复定义，类型不一致风险
- [Minor] `topic-insights.service.ts` 包含私有函数 `cleanHtmlTagsFromContent()`，应移至 `utils/`
- [Info] 注释以中文为主（团队内部合理），但英文注释中夹杂的 `★ v7.2:` 等版本标记注释积累较多，建议定期清理

**扣分**: -2（超大文件 -1，重复定义 -1）

---

## 架构债务优先级矩阵

| 优先级 | 问题类型                                                                           | 维度   | 影响范围   | 修复成本 | 建议时机 |
| ------ | ---------------------------------------------------------------------------------- | ------ | ---------- | -------- | -------- |
| P0     | `MissionController` 部分端点缺 TopicAccessGuard（topic归属校验漏洞）               | D3     | 高（安全） | 低       | 立即     |
| P0     | WebSocket CORS `endsWith(".railway.app")` 过于宽泛                                 | D10    | 高（安全） | 低       | 立即     |
| P1     | `TaskResultJson` 接口重复定义（类型不一致风险）                                    | D4/D12 | 中         | 低       | 本迭代   |
| P1     | `RAGFusionService` 死代码（未注册 Provider，功能失效）                             | D2/D7  | 中（功能） | 低       | 本迭代   |
| P1     | `ResearchMissionService` 与 `MissionLifecycleService` 的 `createMission()` 重复    | D4     | 中（维护） | 中       | 本迭代   |
| P2     | `research-mission.service.ts` 3826行，`research-leader.service.ts` 2758行 继续拆分 | D4/D12 | 中（维护） | 高       | 下次迭代 |
| P2     | `leaderChat` 的 `@Body()` 使用内联类型而非 DTO                                     | D3     | 低         | 低       | 下次迭代 |
| P2     | 中文 Prompt Injection 模式缺失                                                     | D10    | 中（安全） | 低       | 下次迭代 |
| P3     | 版本标记注释清理（`★ v7.2:` 等）                                                   | D12    | 低         | 低       | 长期     |
| P3     | `DataSourceRouterService` 2162行继续拆分                                           | D7     | 低（维护） | 高       | 长期     |

---

## 与 SOTA 对比分析（Perplexity / Google Deep Research / Gemini Deep Research）

### 架构对比

| 能力维度           | SOTA 水平                               | topic-insights 现状                                     | 差距                         |
| ------------------ | --------------------------------------- | ------------------------------------------------------- | ---------------------------- |
| **多阶段研究流程** | 查询分析 → 子任务分解 → 并行检索 → 合成 | Leader→Mission→Tasks→Synthesis 完整 5 阶段              | 接近                         |
| **规划透明度**     | Perplexity 实时显示搜索过程             | PLAN_READY 状态 + `approve-plan` API                    | 接近（缺少流式实时规划展示） |
| **数据源多样性**   | Google 可接入全网                       | 4 个外部 API + ToolRegistry 工具 + RAG                  | 差距较大（缺少通用网络爬取） |
| **多轮对话研究**   | Gemini Deep Research 支持对话调整       | `@Leader` 消息 + `leaderChat` decode                    | 接近                         |
| **引用溯源**       | 全部内容带原始 URL 引用                 | `CitationFormatterService` + `CredibilityReportService` | 接近                         |
| **跨语言研究**     | 英文为主                                | `MultiLanguageResearchService` 实现中/英切换            | 良好                         |
| **自我验证**       | Perplexity 有 fact-check 循环           | `ClaimVerificationService` + `SelfConsistencyService`   | 接近                         |
| **知识图谱**       | 知识关联不对外展示                      | `KnowledgeGraphService`（实现但集成弱）                 | 差距                         |
| **实时性**         | Perplexity 近实时搜索                   | 依赖工具触发，无 push 数据源                            | 差距较大                     |
| **可扩展数据源**   | 闭源接入多个专业 DB                     | 插件化 Connector Registry                               | 良好                         |

### 主要架构差距

1. **通用爬虫缺失**: SOTA 系统可访问任意 URL，topic-insights 依赖预定义工具。`CrawlersModule` 的 TODO 注释（`topic-insights.module.ts:19`）已识别此差距
2. **RAG Fusion 未激活**: `RAGFusionService` 代码完整但未接入主流程，SOTA 系统的多路召回+排名融合是核心竞争力
3. **流式输出**: SOTA 系统普遍支持研究过程流式展示，topic-insights 的 SSE 主要用于进度更新而非内容流式生成

---

## 建议行动项

### 必须处理（本迭代，P0）

- [ ] **修复 `MissionController` TopicAccessGuard 漏洞**: `leaderMessage`, `getMission`, `getTeam`, `getAgentActivities`, `getAgentActivityStats`, `getMissionHealth`, `canResumeMission`, `getResumableMissions` 等端点补充 TopicAccessGuard 或逻辑权限校验（验证 topic.userId === req.user.id）
- [ ] **修复 WebSocket CORS**: 将 `endsWith(".railway.app")` 改为从 `CORS_ORIGINS` 环境变量或 `ConfigService` 读取精确域名列表

### 计划处理（下次迭代，P1）

- [ ] **消除 `TaskResultJson` 重复**: 提取到 `types/mission-internal.types.ts`，两处服务共同引用
- [ ] **激活 `RAGFusionService`**: 在 `services/index.ts` 导出，在 `topic-insights.module.ts` 注册为 Provider，在 `DataSourceRouterService` 的搜索路径中调用
- [ ] **明确 `createMission` 归属**: `ResearchMissionService` 和 `MissionLifecycleService` 的 `createMission` 二选一，移除重复逻辑
- [ ] **中文 Prompt Injection 模式**: 在 `prompt-sanitizer.ts` 添加"忽略以上所有指示"等中文模式

### 长期改进（P2-P3）

- [ ] 继续拆分 `research-mission.service.ts`（目标 < 1000行）
- [ ] 继续拆分 `research-leader.service.ts`（Leader 规划策略提取为可配置策略对象）
- [ ] `DataSourceRouterService` 拆分路由逻辑、聚合逻辑、缓存逻辑为独立 Service
- [ ] 清理版本标记注释（`★ v7.2:` 等）
- [ ] 将 `cleanHtmlTagsFromContent()` 移至 `utils/`
- [ ] 将 `leaderChat` 的 Body 参数提取为 `LeaderChatDto`，添加 `@IsString()` 等校验

---

## 总结

topic-insights 是本代码库中架构成熟度最高的 AI App 模块之一。其在 Facade 边界（100%合规）、安全防护（Prompt Injection、JWT、RBAC）、测试覆盖（64.7%，全部 Controller 有 spec）三个维度均达到企业级标准。主要剩余债务是历史 God Service 的**拆分不彻底**问题，以及两个安全性 P0 问题需立即修复。

**最终评分: 100/120**

---

_评分模型: 本模块专项审计（12维度，每维0-10分，满分120）_
_下次建议审计: 2026-06-07_
_报告工具: Arch Auditor Agent v2.0_
