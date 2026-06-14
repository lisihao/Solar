# 全维度架构质量审计报告

**审计日期**: 2026-02-24
**审计版本**: `e3975915`（git commit 前 8 位）
**审计人**: Arch Auditor Agent (claude-sonnet-4-6)
**审计范围**: backend/src/modules/ai-app/ + ai-engine/（1,020 个生产 TS 文件，581 ai-app + 439 ai-engine；测试文件另计 515 个）
**参考基准**: v3 审计报告（82/100，commit `91173601`）
**审计目标**: 7 维度全面质量评估（架构/设计/代码/工程/功能/性能/安全）

---

## 执行摘要

| 维度                                | 评分（满分 10） | 较 v3 变化 | 状态     |
| ----------------------------------- | --------------- | ---------- | -------- |
| 1. 架构质量（Architecture Quality） | 8.5             | +0.5       | 良好     |
| 2. 设计质量（Design Quality）       | 7.5             | 新增维度   | 良好     |
| 3. 代码质量（Code Quality）         | 7.0             | 新增维度   | 警告     |
| 4. 工程质量（Engineering Quality）  | 8.0             | 新增维度   | 良好     |
| 5. 功能质量（Functional Quality）   | 7.5             | 新增维度   | 良好     |
| 6. 性能质量（Performance Quality）  | 7.0             | 新增维度   | 警告     |
| 7. 安全质量（Security Quality）     | 7.5             | 新增维度   | 良好     |
| **综合评分**                        | **7.6 / 10**    | —          | **良好** |

**架构健康评分（对标 v3 格式）**: 84 / 100（v3: 82/100，+2 分）

### 变化说明

相较 v3 审计基准，本次覆盖更广的 7 个质量维度，并确认了以下改进：

- v3 报告的 ESLint barrel 导入缺口（`orchestration/services` barrel index）已修复
- self-consistency.service.ts 中的 temperature 硬编码已通过 creativity 映射解决
- facade/ai-engine.facade.ts 中 maxTokens: 4000 仅出现在 JSDoc 注释中，非实际调用

两个 v3 P1 违规（`content-analysis.types.ts` 和 `writing-agent-registry.ts`）依然存在，需要持续跟进。

---

## 一、架构质量（Architecture Quality）评分: 8.5 / 10

### 1.1 Facade 边界 — 2 处已知违规（均为 ESLint excludedFiles 已豁免）

| 文件                                                | 行号  | 违规 import                                         | 状态    | 风险 |
| --------------------------------------------------- | ----- | --------------------------------------------------- | ------- | ---- |
| `ai-app/office/common/content-analysis.types.ts`    | 7     | `ai-engine/content-analysis/content-analysis.types` | P1 开放 | 中   |
| `ai-app/writing/registry/writing-agent-registry.ts` | 20-23 | `ai-engine/agents/abstractions/agent.interface`     | P1 开放 | 中   |

**详情**:

`content-analysis.types.ts` 是一个向后兼容的 re-export shim，但没有被加入 ESLint excludedFiles：

```typescript
// ai-app/office/common/content-analysis.types.ts:7
export * from "../../../ai-engine/content-analysis/content-analysis.types";
```

`writing-agent-registry.ts` 中 `AgentOutput` 和 `AgentEvent` 未通过 facade 导出，需要直接引用内部路径。ESLint 文件注释说明了冲突原因。

```typescript
// 注释说明: facade exports a different AgentOutput (facade.types.ts) so re-export is not possible without a name clash
import type {
  AgentOutput,
  AgentEvent,
} from "../../../ai-engine/agents/abstractions/agent.interface";
```

**v3 已修复项（确认）**:

- orchestration/services barrel 导入漏洞：`token-budget.service.ts` shim 现已通过 facade 正确导入
- 所有 ai-engine 内部路径 → ai-app 的反向依赖：**0 处**

### 1.2 模块依赖图

**forwardRef 使用汇总（8 处，均有合理理由）**:

| 位置                                                    | 循环原因                        | 合理性             |
| ------------------------------------------------------- | ------------------------------- | ------------------ |
| `AiImageModule ↔ AiEngineModule`                        | 图片生成工具需要回调 Image App  | 已知，合理         |
| `AiOfficeModule ↔ AiEngineModule`                       | Office 能力注入                 | 已知，合理         |
| `SlidesSkillsModule ↔ AiEngineModule`                   | Skills 依赖 Engine              | 已知，合理         |
| `ResearchProjectModule ↔ AiEngineModule`                | AudioGenerationTool 回调        | 已知，合理         |
| `DiscussionModule ↔ AiEngineModule`                     | 讨论引擎研究循环                | 已知，合理         |
| `AiEngineLlmModule ↔ AiEngineOrchestrationModule`       | LLM ↔ 编排内部循环              | 引擎内部，技术合理 |
| `AiEngineOrchestrationModule ↔ Tools/Skills/Constraint` | 编排注册循环                    | 引擎内部，技术合理 |
| `MCPServerModule ↔ DiscussionModule`                    | MCP Server 依赖 Discussion 能力 | 已知，合理         |

**所有 forwardRef 均有注释说明原因，无未治理的循环依赖。**

### 1.3 注册模式合规

所有 ai-app 模块均在 onModuleInit 中正确注册：

| 模块                | 注册内容                     | 状态 |
| ------------------- | ---------------------------- | ---- |
| ResearchModule      | AgentRegistry + TeamRegistry | 合规 |
| AiTeamsModule       | TeamRegistry + AgentRegistry | 合规 |
| AiOfficeModule      | TeamRegistry (3 configs)     | 合规 |
| AiImageModule       | AgentRegistry                | 合规 |
| AiPlanningModule    | TeamRegistry                 | 合规 |
| AiSimulationModule  | AgentRegistry                | 合规 |
| AiWritingModule     | 通过 WritingAgentRegistry    | 合规 |
| SlidesSkillsModule  | SkillRegistry (动态注册)     | 合规 |
| TopicInsightsModule | 通过服务层注册               | 合规 |

**Writing 团队配置在 WritingMissionService.registerWritingTeamConfig() 中动态注册**，非 onModuleInit 静态注册，但在第一次任务执行时初始化，不影响功能。

### 1.4 架构扣分因素

- **2 处 ESLint 豁免违规**: -0.5 分（仍需最终解决）
- **teams/interfaces/mission-context.interface.ts 存在 @deprecated 标注但仍被多处直接导入**: 技术债务，-0.5 分

```typescript
// ai-app/teams/services/collaboration/mission/team-mission.service.ts:45
} from "../../../interfaces/mission-context.interface"; // 应直接从 ai-engine/facade 导入
```

---

## 二、设计质量（Design Quality）评分: 7.5 / 10

### 2.1 SOLID 原则

**单一职责（SRP）- 主要问题**:

代码库中存在明显的"上帝服务"问题：

| 文件                                                           | 行数      | 方法数          | 问题描述                                                                                     |
| -------------------------------------------------------------- | --------- | --------------- | -------------------------------------------------------------------------------------------- |
| `writing/services/mission/writing-mission.service.ts`          | **8,394** | **46 个 async** | 极度违反 SRP，单文件包含写作任务、Story Bible 注入、质量检查、Agent 协调、实时推送等全部逻辑 |
| `teams/services/collaboration/mission/team-mission.service.ts` | **6,021** | 大量            | 已部分拆分但仍偏大                                                                           |
| `topic-insights/services/core/research-mission.service.ts`     | **3,368** | —               | 合规（已有 MissionQueryService 拆分迹象）                                                    |

**注**: `writing-mission.service.ts` 文件末尾注释已引用多个子服务（WritingAgentCoordinator, WritingContextService, WritingStyleService, WritingQualityService, CheckpointService 等）说明重构意识存在，但主文件仍保持原始大小，实际委托不彻底。

**开闭原则（OCP）- 中等遵循**:

社交模块 `publish-executor.service.ts` 中使用 switch/case 硬编码平台类型，每新增平台需修改此文件：

```typescript
switch (activeConn.platformType) {
  case SocialPlatformType.WECHAT_MP: ...
  case SocialPlatformType.XIAOHONGSHU: ...
  default: throw...
}
```

已知问题（项目记忆中记录为"PublishExecutorService hardcodes 2 platforms"），建议引入 PlatformAdapterRegistry 模式。

**依赖反转（DIP）- 良好**:

- AIEngineFacade 作为统一抽象入口，ai-app 模块通过接口依赖 Engine 层，符合 DIP
- Registry 注入模式（AgentRegistry, TeamRegistry 等）统一管理依赖，良好
- `ai-engine/interfaces/` 目录明确说明了 DIP 设计意图

### 2.2 设计模式使用

**良好实践**:

- Registry 模式（AgentRegistry, TeamRegistry, ToolRegistry, SkillRegistry）: 统一、规范
- Facade 模式（AIEngineFacade）: 2,923 行，功能丰富，覆盖全面
- Adapter 模式（WechatAdapter, XhsMcpAdapter, A2ATeamMemberAdapter）: 合理使用
- Strategy 模式（ExecutionCallbacks 接口用于 MissionExecutionService）: 解耦良好
- Observer 模式（TopicEventEmitterService, WritingEventEmitterService）: 事件驱动良好
- Health Check 模式（MissionHealthCheckService, SlidesMetricsService）: 完善
- Circuit Breaker（CircuitBreakerService）: 完整实现

**待改进**:

- PublishExecutorService 需要 Strategy/Plugin 模式替代 switch
- WritingMissionService 应彻底应用 Facade 委托模式，而非仅形式上引用子服务

### 2.3 接口抽象

`ExecutionCallbacks` 接口在 MissionExecutionService 中用于解耦循环依赖，是一个很好的回调接口设计范例：

```typescript
export interface ExecutionCallbacks {
  completeMission(missionId: string): Promise<void>;
  leaderReviewTask(...): Promise<void>;
  getTeamMembers(...): Promise<...>;
  createLog(...): Promise<void>;
  ...
}
```

---

## 三、代码质量（Code Quality）评分: 7.0 / 10

### 3.1 TypeScript 类型安全 — 中等风险

**ai-app 生产代码（非 spec）中的 `any` 类型使用（9 个文件）**:

| 文件                                                        | 问题                                             | 严重度               |
| ----------------------------------------------------------- | ------------------------------------------------ | -------------------- |
| `image/agents/image-designer.agent.ts`                      | `artifacts: any[]`，`artifact?: any`             | 中                   |
| `image/generation/image-generation.service.ts`              | `modelConfig: any`（x2，有 eslint-disable 注释） | 低（已注释说明原因） |
| `image/export/export.service.ts`                            | `any` 类型                                       | 中                   |
| `social/ai-social.service.ts`                               | 1 处 `any`                                       | 低                   |
| `social/adapters/wechat.adapter.ts`                         | 1 处 `any`                                       | 低                   |
| `writing/services/writing/chapter-writing.service.ts`       | 1 处 `any`                                       | 中                   |
| `writing/services/quality/narrative-craft.service.ts`       | 3 处 `any`                                       | 中                   |
| `writing/services/consistency/fact-extractor.service.ts`    | 1 处 `any`                                       | 中                   |
| `writing/services/mission/checkpoint.service.ts`            | 1 处 `any`                                       | 中                   |
| `topic-insights/services/core/mission-execution.service.ts` | 1 处 `any`                                       | 中                   |
| `topic-insights/services/core/research-mission.service.ts`  | 1 处 `any`                                       | 中                   |
| `research/project/research-project-output.service.ts`       | 2 处 `any`                                       | 中                   |
| `office/slides/orchestrator/slides-team-orchestrator.ts`    | 4 处 `any`                                       | 中                   |
| `teams/ai-teams.service.ts`                                 | 1 处 `any`                                       | 低                   |

**image-generation.service.ts 中的 `modelConfig: any` 最值得关注**，因为它是核心图片生成逻辑的参数类型，应当定义专门的接口。

**ai-engine 生产代码中的 `any` 类型（~6 个文件）**:

- `llm/services/ai-chat-model-config.service.ts`
- `tools/categories/processing/file-conversion.tool.ts`
- `tools/categories/export/export-image.tool.ts`
- `prompts/prompt-template.service.ts`
- `llm/services/ai-image-generation.service.ts`
- `image/adapters/` (4 个 adapter 文件)

### 3.2 错误处理

**良好实践**:

- 绝大多数 async 方法有 try-catch，并通过 Logger 记录
- MissionExecutionService 的错误处理分层（isRetryableError, isRateLimitError, isPermanentError）
- CheckpointService 的 non-throwing save（防止检查点失败影响主流程）

**问题点**:

静默吞错案例（非 spec 文件）:

```typescript
// ai-app/social/adapters/wechat.adapter.ts:607
await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
```

此处静默忽略 networkidle 等待超时是合理的（UI 测试容错），有行内注释说明场景。

```typescript
// ai-engine/tools/categories/integration/webhook-trigger.tool.ts:439
axios(config).catch(() => {}); // intentionally ignore errors
```

webhook fire-and-forget 模式，合理，有注释说明。

**真正有问题的静默吞错**:

```typescript
// ai-engine/memory/memory-coordinator.service.ts:129-138
this.recallLayer1(query, sessionId).catch(() => []);
this.recallLayer2(query, sessionId).catch(() => []);
```

虽然返回空数组而非完全忽略，但内存检索失败不被记录到 Logger，会导致无法追踪内存层故障。

### 3.3 代码复杂度 — 主要风险

**极度复杂文件**（关键治理风险）:

| 文件                                                           | 行数      | 问题                                                              |
| -------------------------------------------------------------- | --------- | ----------------------------------------------------------------- |
| `writing/services/mission/writing-mission.service.ts`          | **8,394** | 46 个 async 方法，跨越写作编排、Story Bible、质量检查等多个职责域 |
| `teams/services/collaboration/mission/team-mission.service.ts` | **6,021** | 历史上的上帝服务，虽已部分拆分但原文件仍巨大                      |

**对比**: `ai-engine/facade/ai-engine.facade.ts` 有 2,923 行，但其职责清晰（单一 Facade 入口）且有大量 JSDoc 注释，可接受。

### 3.4 命名规范

**良好**: 全部使用 kebab-case 目录名、PascalCase 类名、camelCase 方法名，规范统一。

**console.log 残留**:

- 生产代码中无真实 `console.log` 调用（6 个文件中的出现均为：JSDoc 示例代码、测试基准文件、示例文件）
- **ai-engine/facade/ai-engine.facade.ts 中的 console.log 全部在 JSDoc `@example` 注释中**，不是实际调用

---

## 四、工程质量（Engineering Quality）评分: 8.0 / 10

### 4.1 测试覆盖

| 模块      | 生产文件数 | 测试文件数 | 测试文件比 |
| --------- | ---------- | ---------- | ---------- |
| ai-engine | 439        | 215        | 49%        |
| ai-app    | 581        | 300        | 52%        |
| **合计**  | **1,020**  | **515**    | **50%**    |

**已覆盖关键服务**（有 spec 文件）:

- AgentRegistry, TeamRegistry, ToolRegistry, SkillRegistry
- DAGExecutor, ParallelExecutor, RetryStrategy, BaseExecutor, FunctionCallingExecutor
- AiChatService, AiModelConfigService, ModelFallbackService
- CircuitBreakerService, ConstraintEnforcementService, TokenBudgetService
- MissionExecutionService, TeamMissionService (关键路径)
- ResearchMissionService, TopicInsights MissionExecutionService
- WritingMissionService, SlidesTeamOrchestrator

项目记忆记录的覆盖率: AI Engine 90.75%, AI Apps 80.6%，均高于行业标准。

**测试文件中 `any` 使用**: 主要集中在测试文件（Mock 对象）中，约 1,024 处，符合预期（测试文件 ESLint 规则允许 `any`）。

### 4.2 ESLint 规则完备性

**覆盖完整性（9 个 Section，涵盖所有已知 ai-engine 子目录）**:

| Section | 覆盖的路径                                                                                                                                                | 状态                  |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| 1       | agents/**, tools/**, core/\*\*                                                                                                                            | 完整                  |
| 2       | llm/\*\*                                                                                                                                                  | 完整                  |
| 3       | skills/\*\*                                                                                                                                               | 完整                  |
| 4       | teams/abstractions/**, constraints/**, registry/**, services/**                                                                                           | 完整                  |
| 5       | orchestration/services（含 barrel），executors/**, state-machine/**, utils/\*\*                                                                           | 完整（v3 缺口已修复） |
| 6       | rag/\*\*                                                                                                                                                  | 完整                  |
| 7       | long-content/\*\*                                                                                                                                         | 完整                  |
| 8       | capabilities/**, realtime/**, memory/**, content-fetch/**, interfaces/**, mcp/**, image/**, content-analysis/**                                           | 完整                  |
| 9       | synthesis/**, search/**, quality/**, collaboration/**, guardrails/**, evidence/**, a2a/**, prompts/**, observability/**, constraint/**, common/**, api/** | 预防性覆盖            |

**唯一残余缺口**:
`content-analysis.types.ts` 在 excludedFiles 中未被豁免，但其所在目录 `**/ai-engine/content-analysis/**` 已在 Section 8 规则中被限制，所以 ESLint 确实能检测到此违规（v3 已确认为 ESLint 报告的 P1 违规）。

### 4.3 配置管理

**良好实践**:

- 无硬编码品牌名（Genesis/DeepDive/Raven）在生产代码中（仅 1 处在测试文件中）
- 环境变量管理规范：`CORS_ORIGINS`, `GUARDRAILS_ENABLED`, `CACHE_MAX_ITEMS`, `DB_POOL_SIZE` 等
- SecretsService 统一管理 API 密钥，不直接存储明文

**待关注**:

- `ai-engine/llm/services/ai-connection-test.service.ts` 中 `temperature: 0` 用于连通性测试，合理但略显混杂（在 LLM 服务内部直接设置数值）
- 约 4 处 LLM 模型名（claude-3-haiku、llama sonar）仍以字符串形式出现在 `core/` 层，用于 API 密钥验证，低风险但可提取为常量

### 4.4 日志规范

**完全合规**: 所有服务均使用 `private readonly logger = new Logger(ClassName.name)`，无真实 `console.log` 调用。

---

## 五、功能质量（Functional Quality）评分: 7.5 / 10

### 5.1 核心业务逻辑完整性

**AI Research（研究模块）**: 完整

- Discussion 引擎 → 多步骤规划 → 报告合成完整闭环
- ResearchProjectModule 管理 CRUD、Sources、Chat、Notes、Outputs

**AI Teams（多 Agent 协作）**: 完整

- Mission 生命周期（创建 → 分解 → 执行 → Review → 完成）完整
- 健康检查、自动恢复、重试机制健全
- Debate Team、Research Team 配置完整

**AI Writing（写作）**: 功能完整但实现偏重

- Story Bible、Agent Coordinator、5 种 Agent 角色（Architect/Keeper/Writer/Checker/Editor）均有实现
- 7 个质量服务（NarrativeCraft, SemanticConsistency, ExpressionAlternatives, QualityGate, ProfessionalVoice 等）覆盖全面
- **但写作 Mission 服务 8,394 行是系统最大的功能质量风险**（测试覆盖难度高、维护成本高）

**AI Office（文档/PPT）**: 完整

- Slides 5 阶段流水线（Leader规划→执行→审核→质量审计→综合）完整
- 技能系统（14+ skills）完整注册

**AI Social（社交）**: 基本完整，有已知技术债务

- PublishExecutor 硬编码 2 个平台（WECHAT_MP, XIAOHONGSHU），需要 Adapter Registry
- Social MCP Client 已重构为 MCPManager 适配器（符合架构规范）

**Topic Insights（专题洞察）**: 功能部分完整

- 研究流水线完整，但 report.controller.ts 中有 7 处 TODO: Implement 标注：
  - `listReports`, `getReport`, `exportReport`, `compareReports`, `listEvidence`, `getEvidence` 均未实现
  - `topic-dimension.service.ts` 中 `refreshDimension`, `createFromTemplate` 标注为高级功能暂不实现

### 5.2 边界条件处理

**良好**:

- TaskBreakdownService 中的 seenKeys/existingKeys 去重逻辑
- MissionHealthCheckService 的 maxAutoRecoveryAttempts 上限（3 次）
- DAGExecutor 的循环依赖检测（validateDAG 方法）

**不足**:

- A2A Controller `getTaskStatus` 端点可能返回不完整状态（inbound A2A 是 placeholder）
- `topic-insights/controllers/mission.controller.ts:802` 中 `triggerHealthCheck` 缺少 admin role 校验（有 TODO 注释）

### 5.3 @deprecated 模块清理

| 已弃用接口                                          | 当前使用方                                                                       | 建议                           |
| --------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------ |
| `teams/interfaces/mission-context.interface.ts`     | team-mission.service.ts, mission-execution.service.ts, mission-review.service.ts | 直接从 `ai-engine/facade` 导入 |
| `slides/skills/page-type-selection.skill`           | 仍被 skills/index.ts 导出                                                        | 移除导出或删除文件             |
| `slides/orchestrator/types.ts` 中 `previousOutputs` | slides-team-orchestrator.ts 中标注为向后兼容                                     | 下一个大版本移除               |

---

## 六、性能质量（Performance Quality）评分: 7.0 / 10

### 6.1 内存管理

**ai-engine 层（良好）**:

- MCPManager 使用 `LruMap(50)` 限制客户端数量
- ShortTermMemoryService 使用 `LruMap(capacity)` 限制会话数量
- CostController 使用 `LruMap(1000)` 和 `LruMap(200)` 分别限制预算和定价缓存
- A2A Controller 使用 `LruMap` 限制速率限制器大小

**ai-app 层（潜在风险）**:

以下 Map/Set 是进程级别的无限增长结构：

| 位置                                   | 类型                                                   | 风险                                                                   |
| -------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------- |
| `mission-health-check.service.ts:57`   | `private recoveryAttempts = new Map<string, number>()` | 有 `cleanupCompletedMission()` 清理，但需确保每次 mission 完成都被调用 |
| `mission-execution.service.ts:123`     | `private pendingExecutions = new Set<string>()`        | missionId 字符串，通常数量有限，低风险                                 |
| `team-mission.service.ts:103`          | `private pendingExecutions = new Set<string>()`        | 同上                                                                   |
| `social/core/mcp-client.service.ts:30` | `private readonly startingServers = new Set<string>()` | 服务器 ID，通常有限，低风险                                            |

**主要关注**：`recoveryAttempts` Map 的清理路径依赖 `resetRecoveryAttempts` 或 `cleanupCompletedMission` 被正确调用。若某个 mission 异常终止未触发清理，此 Map 会持久增长。建议改用 `LruMap`。

### 6.2 异步操作优化

**良好实践**:

- `mapWithConcurrency` 工具函数用于控制并发执行（MissionExecutionService, TopicInsights）
- DAGExecutor 支持并行节点执行（maxConcurrency: 10）
- 写作 ParallelPoolService 支持并行章节生成

**潜在 N+1 风险**:

在 `team-mission.service.ts` 的多个 for-of 循环中，存在嵌套的 Prisma 查询模式，如：

```typescript
for (const task of mission.tasks) { // 可能触发每任务的单独查询
  ...
}
for (const task of stuckTasks) {
  // 每个 task 触发单独的 status update
}
```

虽然大多数案例使用了 `prisma.agentTask.updateMany`（批量更新），但部分地方仍有逐条更新的痕迹。建议全面审查 for-of 内的 Prisma 调用。

### 6.3 缓存策略

**已实现**:

- AiSocialService 使用 CacheService（Redis）缓存 Platform Connections 和 Content 列表
- AiChatService 有模型配置缓存（来自 LLM 层）

**缺口**:

- Topic Insights 研究结果没有明显的缓存层（每次合成都重新计算）
- Research Discussion 的 ReportSynthesizer 每次调用都全量读取 dimension 数据

---

## 七、安全质量（Security Quality）评分: 7.5 / 10

### 7.1 API 认证授权

**良好**:

- `@UseGuards(JwtAuthGuard)` 在所有 Controller 类级别使用
- `TopicAccessGuard` 在敏感端点的方法级别追加
- A2A Controller 有 `A2AApiKeyGuard`（基于 `safeCompare()` 时序安全比较）

**风险**:

```typescript
// topic-insights/controllers/mission.controller.ts:797-803
async triggerHealthCheck(@Request() req: RequestWithUser) {
  const userId = req.user?.id;
  if (!userId) throw new UnauthorizedException();
  // TODO: Add admin role check  ← 任何登录用户都可触发健康检查
  const result = await this.healthService.forceHealthCheck();
  return result;
}
```

此端点允许任何已认证用户触发全量健康检查，应限制为管理员角色。

### 7.2 输入验证

**良好**:

- DTO 类使用 class-validator 装饰器进行输入校验
- Puppeteer 场景中有 XSS 防护逻辑
- Common utils 中有 `sanitizeForDb`, `sanitizeJson`, `logSanitizer` 工具

**潜在风险**:

- `ai-engine/a2a/a2a.controller.ts` 中使用 `eslint-disable @typescript-eslint/no-unsafe-assignment` 注释处理 `context` 和 `constraints` 类型：
  ```typescript
  context: (request.config?.context ?? "") as string,
  constraints: request.config?.constraints as Partial<ConstraintProfile> | undefined,
  ```
  运行时 `as` 断言不做实际类型校验，若传入恶意结构可能绕过约束。

### 7.3 敏感信息处理

**良好**:

- API 密钥通过 `SecretsService` 管理，不直接存储在业务逻辑中
- `safeCompare()` 用于 API Key 比较（防时序攻击）
- Session 数据通过 `encryptSession/decryptSession` 加密（social 模块）
- SQL 注入防护：使用 Prisma ORM + 参数化查询（raw query 有白名单）

### 7.4 CORS 和速率限制

**良好**:

- CORS 通过 `CORS_ORIGINS` 环境变量精确匹配（非通配符）
- A2A 端点有 `LruMap` 基础的速率限制
- Guardrails（输入/输出 validation）已通过 `GUARDRAILS_ENABLED` 标志接入 AiChatService

---

## 八、关键发现汇总（按优先级）

### P0 — 无（无立即修复需要的严重违规）

### P1 — 需要计划修复（2 处）

| 序号 | 类别        | 文件                                                      | 问题                                                      | 修复方案                                                                      |
| ---- | ----------- | --------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------- |
| P1-1 | Facade 边界 | `ai-app/office/common/content-analysis.types.ts:7`        | re-export shim 直接引用 ai-engine 内部路径，ESLint 未豁免 | 将类型添加到 `facade/index.ts` 后改从 facade 导入，或将文件加入 excludedFiles |
| P1-2 | Facade 边界 | `ai-app/writing/registry/writing-agent-registry.ts:20-23` | `AgentOutput`/`AgentEvent` 直接引用 agents 内部接口       | 将 `AgentOutput`/`AgentEvent` 添加到 `facade/index.ts` 解决命名冲突           |

### P2 — 建议近期处理（7 处）

| 序号 | 类别     | 位置                                                                      | 问题                                                     |
| ---- | -------- | ------------------------------------------------------------------------- | -------------------------------------------------------- |
| P2-1 | 代码质量 | `writing/services/mission/writing-mission.service.ts`                     | 8,394 行上帝服务，重构优先级高                           |
| P2-2 | 安全质量 | `topic-insights/controllers/mission.controller.ts:802`                    | `triggerHealthCheck` 缺少 admin role guard               |
| P2-3 | 功能质量 | `topic-insights/controllers/report.controller.ts`                         | 7 处 TODO: Implement 未实现端点                          |
| P2-4 | 设计质量 | `social/services/publish-executor.service.ts`                             | switch/case 硬编码平台，需要 PlatformAdapterRegistry     |
| P2-5 | 性能质量 | `teams/services/collaboration/mission/mission-health-check.service.ts:57` | `recoveryAttempts` Map 清理依赖外部调用，建议改用 LruMap |
| P2-6 | 架构质量 | `teams/interfaces/mission-context.interface.ts`                           | @deprecated shim 仍被多处导入，需要迁移到 facade 导入    |
| P2-7 | 代码质量 | `image/generation/image-generation.service.ts:207,301`                    | `modelConfig: any` 参数缺少类型定义                      |

### P3 — 长期改进（5 处）

| 序号 | 类别     | 位置                                         | 问题                                                               |
| ---- | -------- | -------------------------------------------- | ------------------------------------------------------------------ |
| P3-1 | 代码质量 | `ai-app/` 生产代码 14 个文件                 | 约 30 处非测试文件 `any` 类型需要逐步消除                          |
| P3-2 | 工程质量 | `core/` 模块                                 | 4 处硬编码模型名（cladue-3-haiku 等）用于 Key 验证，建议提取为常量 |
| P3-3 | 性能质量 | `memory/memory-coordinator.service.ts`       | `.catch(() => [])` 吞掉内存检索失败，建议记录 debug 日志           |
| P3-4 | 功能质量 | `slides/skills/page-type-selection.skill.ts` | @deprecated skill 仍被导出，建议移除                               |
| P3-5 | 工程质量 | `ai-engine/a2a/a2a.controller.ts`            | inbound A2A createTask/getTaskStatus 的完整性需要跟进              |

---

## 九、亮点（值得保留和推广的好实践）

### 架构设计亮点

1. **AIEngineFacade 作为统一入口**: 2,923 行，完整覆盖 Engine 能力，ESLint 规则强制执行边界，架构清晰度行业领先

2. **9 节 ESLint no-restricted-imports**: 预防性覆盖所有 ai-engine 子目录，包括尚未被 App 层访问的预防性条目（synthesis, search, quality 等），设计前瞻

3. **注册模式（Registry + onModuleInit）**: 统一的 Agent/Team/Tool/Skill 注册机制，所有 ai-app 模块均遵循，一致性极好

4. **forwardRef 使用有迹可循**: 所有 8 处 forwardRef 均有注释说明循环原因，未来维护者可快速理解

### 工程实践亮点

5. **LruMap 内存防护**: ai-engine 层的核心有界 Map（MCPManager, ShortTermMemory, CostController, A2A RateLimiter）全部使用 LruMap，内存安全

6. **`safeCompare()` 时序安全**: API Key 比较统一使用 timingSafeEqual，防止时序攻击

7. **Circuit Breaker + Guardrails 接入**: `CircuitBreakerService` 在 AiChatService 中记录成功/失败，`GUARDRAILS_ENABLED` 标志可动态开关，生产就绪

8. **健康检查体系**: MissionHealthCheckService, SlidesMetricsService, WritingMissionHealthCheck 三层健康检查，自动恢复机制完善

### 代码质量亮点

9. **ExecutionCallbacks 接口解耦**: `MissionExecutionService` 通过回调接口与 `TeamMissionService` 解耦，避免循环依赖的优雅方案

10. **taskProfile + creativity 映射**: 所有 LLM 调用统一通过 TaskProfile 语义化描述，写作模块 20+ 处 LLM 调用全部完成 temperature → creativity 映射，注释详细

11. **测试覆盖率**: AI Engine 90.75%, AI Apps 80.6%，515 个测试文件，覆盖关键路径

12. **@deprecated 明确标注**: 已弃用的接口、方法、类均有 `@deprecated` 注释指引替代方案，维护者体验良好

---

## 十、趋势分析（对比历史审计）

| 维度        | v1 得分 | v2 得分 | v3 得分 | 本次             | 趋势     |
| ----------- | ------- | ------- | ------- | ---------------- | -------- |
| Facade 边界 | 低      | 14/35   | 33/35   | 8.5/10           | 显著改善 |
| LLM 硬编码  | —       | 17/20   | 14/20   | 合规（仅注释中） | 改善     |
| any 类型    | —       | 15/20   | 10/20   | 7/10             | 有改善   |
| 反向依赖    | —       | 10/10   | 10/10   | 10/10            | 满分维持 |
| 注册模式    | —       | 5/5     | 5/5     | 5/5              | 满分维持 |
| 代码规范    | —       | 4/5     | 5/5     | 5/5              | 满分维持 |
| 综合        | 低      | 57/100  | 82/100  | 84/100           | 持续改善 |

---

## 十一、建议行动项

### 必须处理（本迭代）

- [ ] **P1-1**: 将 `ContentAnalysisTypes` 添加到 `ai-engine/facade/index.ts` 或将 `content-analysis.types.ts` 加入 ESLint excludedFiles
- [ ] **P1-2**: 将 `AgentOutput`/`AgentEvent` 添加到 `facade/index.ts`（解决与 facade.types.ts 的命名冲突后）
- [ ] **P2-2**: 为 `triggerHealthCheck` 端点添加 admin role guard

### 计划处理（下次迭代）

- [ ] **P2-3**: 实现 topic-insights 的 7 个 TODO 接口（listReports, getReport 等）
- [ ] **P2-5**: 将 `recoveryAttempts` Map 改为 `LruMap<string, number>(1000)`
- [ ] **P2-6**: 将 `teams/interfaces/mission-context.interface.ts` 的使用者迁移为从 `ai-engine/facade` 直接导入，然后删除 shim 文件

### 长期改进（下一个季度）

- [ ] **P2-1**: 拆分 `writing-mission.service.ts`（8,394 行），完成已引用的子服务的实际委托
- [ ] **P2-4**: 引入 `PlatformAdapterRegistry`，消除 `publish-executor.service.ts` 中的 switch/case
- [ ] **P3-1**: 逐步消除生产代码中的 `any` 类型，优先处理 `image-generation.service.ts` 的 `modelConfig: any`
- [ ] **P3-4**: 移除 `@deprecated` 的 `page-type-selection.skill` 导出

---

## 十二、下次审计建议

**建议下次审计时间**: 2026-03-24（距今 1 个月）

**重点关注方向**:

1. P1 Facade 违规是否已修复
2. writing-mission.service.ts 拆分进展
3. topic-insights 功能完整性提升
4. A2A inbound 接口实现进展

---

_报告生成工具: Arch Auditor Agent v1.0_
_模型: claude-sonnet-4-6_
_生成时间: 2026-02-24_
_参考文件: 本次审计读取了 40+ 个源文件，运行了 50+ 次代码扫描_
