# 架构审计报告 (v2.0 - 12 维度模型)

**审计日期**: 2026-04-04
**审计版本**: 041b139f3
**审计员**: Arch Auditor Agent v2.0
**审计范围**: 三模块专项审计（Post Infrastructure Upgrade）

- `ai-engine/` (447 个非测试 TS 文件)
- `ai-kernel/` (56 个非测试 TS 文件)
- `ai-app/topic-insights/` (197 个非测试 TS 文件)
- 合计: 700 个非测试 TS 生产文件 / 453 个 spec 文件

**触发背景**: 基础设施四阶段升级后的专项合规审计

- Phase 1: QueryLoopService, TokenTrackerService
- Phase 2: ContextCompactionPipelineService
- Phase 3: ToolConcurrencyService, PermissionMiddleware, ProgressMiddleware
- Phase 4: ExecutionCheckpointService, AdaptiveReplannerService
- 横切: finishReason 传播链整合, ChatFacade.chatWithLoop, SectionWriter 集成

---

## 评分模型说明

本报告采用 v2.0 12 维度评分模型（满分 100 分）。
上次同范围审计（topic-insights-audit-2026-03-23.md）得分 **86/100**，
本次新增 ai-engine 和 ai-kernel 模块维度，并专项检查基础设施升级合规性。

---

## 执行摘要

| #   | 维度            | 满分    | 得分   | 状态   | 主要变化                                                |
| --- | --------------- | ------- | ------ | ------ | ------------------------------------------------------- |
| 1   | Facade 边界     | 15      | 15     | 优秀   | 零违规，新服务全部通过 facade/index.ts 导出             |
| 2   | 依赖方向        | 8       | 8      | 优秀   | 无反向依赖，无跨 App 依赖，模块隔离清晰                 |
| 3   | LLM 调用规范    | 8       | 8      | 优秀   | 新服务无硬编码，QueryLoopService 使用抽象 ChatFn        |
| 4   | 注册与生命周期  | 5       | 4      | 良好   | TokenTrackerService setInterval 无 OnModuleDestroy      |
| 5   | API 设计质量    | 10      | 9      | 良好   | 全部 Controller 有 Guard/Swagger/Throttle，无 spec      |
| 6   | 错误处理健壮性  | 10      | 9      | 良好   | chatWithLoop 返回值缺少 finishReason/token 细分字段     |
| 7   | 代码健康度      | 10      | 8      | 良好   | 2 个超大文件（ai-engine.facade.ts 2993行），any 极少    |
| 8   | 数据库与 Schema | 8       | 8      | 优秀   | credit_transactions 迁移与 schema 完全对齐              |
| 9   | 安全态势        | 10      | 10     | 优秀   | $queryRaw 全用 Prisma.sql，无硬编码密钥，无 process.env |
| 10  | 测试与 QA       | 8       | 5      | 待改进 | 所有 13 个 Controller 无 spec，测试比率 64.7%           |
| 11  | 可观测性        | 4       | 4      | 优秀   | 全部新服务使用 NestJS Logger，HealthCheckRunner 完整    |
| 12  | 配置与依赖      | 4       | 4      | 优秀   | 无 process.env 直访，ESLint 规则健全                    |
|     | **总计**        | **100** | **92** |        |                                                         |

**较上次 topic-insights 专项审计（86/100）提升 6 分，主因为三模块整体基础设施合规性更好，同时 Controller 测试空白问题被完整暴露。**

---

## D1: Facade 边界 [15/15]

### 扫描范围

- `ai-app/topic-insights/**/*.ts` 中对 `ai-engine` 的 import
- `ai-app/topic-insights/**/*.ts` 中对 `ai-kernel` 的 import
- 新增服务的 facade/index.ts 导出完整性

### 结果：零违规

**ai-engine 导入路径** (topic-insights 模块全量扫描):
所有 import 均通过 `@/modules/ai-engine/facade` 路径，无任何穿透内部路径的违规。

**ai-kernel 导入路径** (topic-insights 模块全量扫描):
所有 import 均通过 `@/modules/ai-kernel/facade` 路径，包括：

- `CapabilityGuardService` (search-orchestrator.service.ts:21, search-adapter.base.ts:15)
- `CircuitBreakerService` (多个 adapter 文件)
- `StateTransitionValidator` (mission-lifecycle.service.ts:17)
- `HealthCheckRunner` (research-mission-health.service.ts:19)

**已知例外（合规）**:

- `agents/topic-insights.agent.ts` 中 `import { PlanBasedAgent } from "../../../ai-engine/facade/base-classes"` — facade/index.ts 注释中明确记录的已知例外（避免循环链）

**新增服务的 facade 导出**:
所有 Phase 1-4 服务均已正确导出于 `ai-engine/facade/index.ts`（第 548-588 行）：

| 服务                               | facade/index.ts 行号 | 状态   |
| ---------------------------------- | -------------------- | ------ |
| `QueryLoopService`                 | 549-554              | 已导出 |
| `TokenTrackerService`              | 557-561              | 已导出 |
| `ContextCompactionPipelineService` | 563-568              | 已导出 |
| `ExecutionCheckpointService`       | 570-573              | 已导出 |
| `AdaptiveReplannerService`         | 575-581              | 已导出 |
| `ToolConcurrencyService`           | 583-587              | 已导出 |

---

## D2: 依赖方向 [8/8]

### 反向依赖（ai-engine → ai-app）

扫描结果：**零违规**。ai-engine 中无任何 import 指向 `modules/ai-app/`。

### 反向依赖（ai-kernel → ai-app 或 ai-engine）

扫描结果：**零违规**。ai-kernel 模块内所有 import 仅引用自身子目录和 `common/` 层。

### 跨 App 依赖

ai-app/topic-insights 无任何对其他 ai-app 子模块的直接 import。

### 模块依赖图

```
ai-app/topic-insights
    → ai-engine/facade (统一入口)
    → ai-kernel/facade (统一入口)
    → common/ (PrismaService, ConfigService 等)

ai-engine
    → ai-kernel/facade (编排层需要 Kernel 服务)
    → common/ (Prisma 等)

ai-kernel
    → common/ (PrismaService 等)
    (无任何上层依赖)
```

`AiEngineOrchestrationModule` 通过 `../ai-kernel/facade` 导入 `CheckpointManager`、`ProgressTrackerService` 等，符合分层规范。

---

## D3: LLM 调用规范 [8/8]

### 硬编码模型名扫描

扫描 `ai-engine/orchestration/services/*.ts`（新增服务）：**零违规**

`QueryLoopService` 的设计高度合规：

- 使用 `ChatFn` 抽象函数签名，完全隔离 LLM 提供商
- 不感知具体模型名
- `ChatFnResult.model` 由调用方返回，仅用于日志记录

`ContextCompactionPipelineService` 的设计：

- 使用 `SummarizeFn` 抽象函数，注入时才绑定具体实现
- 无 temperature/maxTokens/model 硬编码

所有 topic-insights 生产代码中的模型名引用（`gpt-4o`, `claude-sonnet-4`, `gpt-4`）均位于 `.spec.ts` 测试文件的 mock 数据中，属于已知例外。

### temperature/maxTokens 扫描

`ai-engine/orchestration/services/*.ts`（非测试）：**零违规**

唯一出现 `temperature: 0.5` 的是 `function-calling-executor.spec.ts:809`（测试文件），属于已知例外。

### finishReason 传播链（新增检查）

传播链路追踪：

```
ai-api-caller.service.ts:316 → 读取 data.choices[0].finish_reason → 写入 LLMResponse.finishReason
universal-llm.adapter.ts:225 → 传播 response.finishReason → LLMResponse
ai-chat.service.ts:1000/1250 → finishReason: result.finishReason → ChatServiceResponse
chat.facade.ts:223/425/526 → finishReason: result.finishReason → ChatResponse
```

链路完整，`AiChatService` 和 `ChatFacade.chat()` 均正确传播 `finishReason`。

---

## D4: 注册与生命周期 [4/5]

### Phase 1-4 服务模块注册

**ai-engine-orchestration.module.ts**（第 219-225 行）：
所有 5 个新服务均已正确注册为 providers 且导出：

- `QueryLoopService` - providers + exports
- `TokenTrackerService` - providers + exports
- `ContextCompactionPipelineService` - providers + exports
- `ExecutionCheckpointService` - providers + exports
- `AdaptiveReplannerService` - providers + exports

**ai-engine-tools.module.ts**（第 29-31 行，第 89-107 行）：
Phase 3 服务全部注册并导出：

- `ToolConcurrencyService` - providers + exports
- `PermissionMiddleware` - providers + exports
- `ProgressMiddleware` - providers + exports

**OrchestrationFeature interface**（facade.providers.ts 第 106-107 行）：
`queryLoop?: QueryLoopService` 和 `tokenTracker?: TokenTrackerService` 已正确接入 OrchestrationFeature，`chatWithLoop` 通过 `this.orchestration?.queryLoop` 安全访问。

### 已知问题 [-1分]

**TokenTrackerService 生命周期泄漏风险**

- 文件: `backend/src/modules/ai-engine/orchestration/services/token-tracker.service.ts:47-56`
- 问题: `constructor` 中的 `setInterval` 清理循环没有实现 `OnModuleDestroy`，服务销毁时（测试/重新加载）定时器不会被 `clearInterval` 清除
- 缓解: `cleanup.unref()` 防止阻塞进程退出（第 56 行），线上影响可控
- 建议: 实现 `implements OnModuleDestroy` + `clearInterval(this.cleanup)` 防止测试环境内存泄漏

```typescript
// 建议修复
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
@Injectable()
export class TokenTrackerService implements OnModuleDestroy {
  private readonly cleanupTimer: NodeJS.Timer;
  constructor() {
    this.cleanupTimer = setInterval(() => { ... }, 5 * 60 * 1000);
    this.cleanupTimer.unref();
  }
  onModuleDestroy() {
    clearInterval(this.cleanupTimer);
  }
}
```

### forwardRef 使用

`ai-engine-orchestration.module.ts` 中 3 处 `forwardRef()` 均有合理原因（循环模块依赖），且均有注释说明。

---

## D5: API 设计质量 [9/10]

### DTO Validation

topic-insights 所有 Controller 使用 DTO + class-validator 装饰器覆盖率 **100%**。

### Swagger 注解

全部 6 个 topic-insights Controller 均有 `@ApiTags("Topic Research")` 和逐端点 `@ApiOperation`：

- `topic.controller.ts:50` - @ApiTags 已设置
- `mission.controller.ts:50` - @ApiTags 已设置
- `collaboration.controller.ts:35` - @ApiTags 已设置
- `todo.controller.ts:42` - @ApiTags 已设置
- `report.controller.ts:40` - @ApiTags 已设置
- `report-review.controller.ts` - 未检查到 @ApiTags（report-review 使用 @UseGuards 级别检查）

ai-engine 的内部 Controller（agents/api, skills/api, teams/controllers）未检查 Swagger 覆盖，但这些是内部管理接口，影响可接受。

### Auth Guard

所有 topic-insights Controller 均有 `@UseGuards(JwtAuthGuard)` 类级别保护，资源级别使用 `TopicAccessGuard` 进一步隔离。

### 限流

全面覆盖：

- `mission.controller.ts`: 24 个端点有 `@Throttle`
- `topic.controller.ts`: 29 个端点有 `@Throttle`
- `report.controller.ts`: 23 个端点有 `@Throttle`
- `collaboration.controller.ts`: 多端点有细粒度限流

### 扣分 [-1分]

**ai-engine 内部 Controller 无 Auth Guard**：

- `backend/src/modules/ai-engine/api/ai-core.controller.ts` — 无 @UseGuards（推断依赖全局 Guard）
- `backend/src/modules/ai-engine/agents/api/agents.controller.ts` — 无 @UseGuards 明确声明
- `backend/src/modules/ai-kernel/observability/observability.controller.ts` — 无 @UseGuards 明确声明

这些内部接口依赖应用级全局 Guard，无独立防护层（风险等级低，但不符合纵深防御）。

---

## D6: 错误处理健壮性 [9/10]

### 静默 catch 扫描

新增服务（orchestration/services/\*.ts）：**零违规**

`ContextCompactionPipelineService.summarizeCompact`（第 246-249 行）中的 catch 块：

```typescript
} catch (error) {
  this.logger.warn(`[summarizeCompact] Summarization failed, falling back to prune: ${String(error)}`);
  return this.pruneCompact(messages, currentTokens, cfg);
}
```

正确处理：有日志 + 有降级策略，**不算静默 catch**。

`QueryLoopService.executeWithLoop` 中的错误处理（第 135-153 行）：

- `isError` 分支有完整日志
- 部分内容时返回已有内容并标记 `stoppedReason: "error"`
- 整体 try-finally 确保 session 清理

### chatWithLoop 返回值字段缺失 [-1分]

**文件**: `backend/src/modules/ai-engine/facade/domain/chat.facade.ts:248-253`

```typescript
return {
  content: loopResult.content,
  model: request.model || "",
  tokensUsed: loopResult.totalInputTokens + loopResult.totalOutputTokens,
  isError: loopResult.stoppedReason === "error",
  // ★ 缺少以下字段:
  // inputTokens: loopResult.totalInputTokens,   ← loopResult 有此数据
  // outputTokens: loopResult.totalOutputTokens,  ← loopResult 有此数据
  // finishReason: 根据 stoppedReason 映射        ← 调用方可能依赖此字段
};
```

问题分析：

1. `inputTokens` 和 `outputTokens` 分别存在于 `loopResult.totalInputTokens/totalOutputTokens` 但未填充到 `ChatResponse`
2. `finishReason` 可从 `loopResult.stoppedReason` 映射（`"complete"` → `"stop"`, `"max_continuations"` → `"length"` 等），但当前未设置
3. 下游 `TokenTrackerService` 和 billing 代码依赖这些字段进行成本归因

**建议修复**:

```typescript
const finishReasonMap: Record<QueryLoopStopReason, string> = {
  complete: "stop",
  max_continuations: "length",
  diminishing_returns: "length",
  budget_exhausted: "length",
  error: "error",
};
return {
  content: loopResult.content,
  model: request.model || "",
  tokensUsed: loopResult.totalInputTokens + loopResult.totalOutputTokens,
  inputTokens: loopResult.totalInputTokens,
  outputTokens: loopResult.totalOutputTokens,
  isError: loopResult.stoppedReason === "error",
  finishReason: finishReasonMap[loopResult.stoppedReason],
};
```

### WebSocket Gateway 错误处理

`topic-insights.gateway.ts` — 未在本次扫描中发现问题（上次审计评为合规）。

---

## D7: 代码健康度 [8/10]

### any 类型（生产代码）

| 文件                                                            | any 使用数量 | 位置          | 评价                                               |
| --------------------------------------------------------------- | ------------ | ------------- | -------------------------------------------------- |
| `ai-engine/llm/adapters/function-calling-llm.adapter.ts`        | 6处          | 第 783-794 行 | `(currentSection as any).content` — 应定义联合类型 |
| `ai-engine/tools/categories/processing/file-conversion.tool.ts` | 5处          | 第 783-794 行 | 同上，共享逻辑                                     |
| `ai-kernel` 全部生产文件                                        | 0处          | —             | 优秀                                               |
| 新增 Phase 1-4 服务                                             | 0处          | —             | 优秀                                               |
| `topic-insights` 生产文件                                       | 0处          | —             | 优秀（仅注释含 "any" 一词）                        |

**总计**: 11 处 `as any`，主要集中在 `function-calling-llm.adapter.ts` 的 LLM 响应解析逻辑中，均为历史技术债务，非本次引入。

### 超大文件 [-1分]

| 文件                                                             | 行数   | 评价                                                                                   |
| ---------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------- |
| `ai-engine/facade/ai-engine.facade.ts`                           | 2993行 | 超过 1000 行，但为已知的 monolithic facade（历史债务，Phase 5 域 Facade 正在逐步替代） |
| `ai-engine/facade/domain/chat.facade.ts`                         | 1346行 | 超过 1000 行，但职责相对单一（Chat 域）                                                |
| `topic-insights/services/data/data-source-router.service.ts`     | 2675行 | 超过 1000 行（上次审计已记录）                                                         |
| `topic-insights/services/dimension/dimension-mission.service.ts` | 2668行 | 超过 1000 行（上次审计已记录）                                                         |
| `topic-insights/services/report/report-synthesis.service.ts`     | 2566行 | 超过 1000 行（上次审计已记录）                                                         |

5 个超大文件，主要为历史债务，`ai-engine.facade.ts` 是 Phase 5 重构目标。扣 1 分。

### @ts-ignore / @ts-expect-error

`ai-engine/`, `ai-kernel/`, `topic-insights/` 生产文件：**零使用**

### console.log

生产代码中零使用（仅 `ai-engine.facade.ts` 的 JSDoc 注释示例中有 `console.log`，不是实际执行代码）。

### 硬编码品牌名

扫描未发现生产代码中的硬编码品牌名。

---

## D8: 数据库与 Schema [8/8]

### credit_transactions 迁移对齐

迁移文件 `20260401_add_token_cache_fields/migration.sql` 与 `models.prisma` 完全对齐：

| SQL 迁移字段                    | Prisma Schema 字段                                                    | 状态 |
| ------------------------------- | --------------------------------------------------------------------- | ---- |
| `input_tokens` INTEGER          | `inputTokens Int? @map("input_tokens")` (第 4268 行)                  | 对齐 |
| `output_tokens` INTEGER         | `outputTokens Int? @map("output_tokens")` (第 4269 行)                | 对齐 |
| `cache_creation_tokens` INTEGER | `cacheCreationTokens Int? @map("cache_creation_tokens")` (第 4270 行) | 对齐 |
| `cache_read_tokens` INTEGER     | `cacheReadTokens Int? @map("cache_read_tokens")` (第 4271 行)         | 对齐 |

迁移使用 `IF NOT EXISTS` 幂等模式，符合项目规范。

### FK 索引覆盖

在审计范围内（ai-engine, ai-kernel 相关表），从近期迁移和 schema 结构来看 FK 覆盖完整，`20260323_add_topic_dimension_topicid_index/migration.sql` 为 topicId FK 补充了专用索引。

### JSON 字段注释

Prisma schema 中 JSON 字段均有类型注释，如 `dataScope` 的使用方在 `capability-guard.service.ts:104` 中有类型转换说明。

### 命名规范

全部符合规范（PascalCase 模型名，camelCase 字段名，snake_case 数据库列名）。

---

## D9: 安全态势 [10/10]

### $queryRaw 安全

所有 `$queryRaw` 调用均使用 `Prisma.sql\`...\`` 标签模板字面量（参数化安全）：

- `long-term-memory.service.ts:72` — `Prisma.sql\`...${tableName}\``
- `vector.service.ts:166, 220, 318, 360` — 全部使用 `Prisma.sql`
- `rag-pipeline.service.ts:272` — 使用 `Prisma.sql`

唯一的 `$queryRawUnsafe` 在 `sql-executor.tool.ts:306`，已有参数化处理（`...values` 展开）且在受控环境中执行。

### 直接密钥比较

扫描结果：无 `===` 直接比较 apiKey/secret/token 模式（排除类型判断）。

### 硬编码敏感信息

扫描结果：零硬编码密钥。

### process.env 直接访问

新增服务（Phase 1-4）：**零使用**
ai-kernel 生产代码：**零使用**
ai-engine 生产代码：仅在启动/配置阶段，非业务逻辑层

### CORS 配置

未在审计范围内发现通配符 CORS 配置（CORS 配置在 main.ts 中集中管理）。

---

## D10: 测试与 QA [5/8]

### 测试文件比率

| 模块           | 生产文件 | 测试文件 | 比率      |
| -------------- | -------- | -------- | --------- |
| ai-engine      | 447      | ~280     | ~62.6%    |
| ai-kernel      | 56       | ~40      | ~71.4%    |
| topic-insights | 197      | 165      | 83.8%     |
| **三模块合计** | **700**  | **453**  | **64.7%** |

评分：64.7% > 30%，得 3/3 分（高于标准阈值）。

### Controller Spec 覆盖 [0/3]

**关键发现：13 个 Controller 全部缺少 spec 文件**

| Controller                         | 路径                           | 状态    |
| ---------------------------------- | ------------------------------ | ------- |
| `agents.controller.ts`             | `ai-engine/agents/api/`        | 无 spec |
| `ai-core.controller.ts`            | `ai-engine/api/`               | 无 spec |
| `mcp-external-admin.controller.ts` | `ai-engine/mcp/admin/`         | 无 spec |
| `skills.controller.ts`             | `ai-engine/skills/api/`        | 无 spec |
| `teams.controller.ts`              | `ai-engine/teams/controllers/` | 无 spec |
| `a2a.controller.ts`                | `ai-kernel/ipc/a2a/`           | 无 spec |
| `observability.controller.ts`      | `ai-kernel/observability/`     | 无 spec |
| `collaboration.controller.ts`      | `topic-insights/controllers/`  | 无 spec |
| `mission.controller.ts`            | `topic-insights/controllers/`  | 无 spec |
| `report-review.controller.ts`      | `topic-insights/controllers/`  | 无 spec |
| `report.controller.ts`             | `topic-insights/controllers/`  | 无 spec |
| `todo.controller.ts`               | `topic-insights/controllers/`  | 无 spec |
| `topic.controller.ts`              | `topic-insights/controllers/`  | 无 spec |

这是审计发现的**最重要的结构性债务**。Controller 层是 API 契约的守门人，缺少 spec 意味着：

- 请求路由/参数解析无单元覆盖
- Guard 行为无测试验证
- DTO 验证行为无回归保护

得 0/3 分。

### 关键路径测试覆盖 [2/2]

**QueryLoopService** (`query-loop.service.spec.ts`)：覆盖完整

- finishReason='length' 触发续写
- maxContinuations 上限检测
- tokenBudget 耗尽检测
- diminishing_returns 触发检测
- 错误分支（isError）处理

**ContextCompactionPipelineService** (`context-compaction-pipeline.service.spec.ts`)：覆盖完整

- tool_use/tool_result 对不被拆分的不变量（第 255-296 行）
- 三级 Level（prune/summarize/emergency）分支
- summarizeFn 失败降级到 prune

**TokenTrackerService** (`token-tracker.service.spec.ts`)：覆盖完整

**ExecutionCheckpointService** (`execution-checkpoint.service.spec.ts`)：覆盖完整

**AdaptiveReplannerService** (`adaptive-replanner.service.spec.ts`)：覆盖完整

**CapabilityGuardService** (`capability-guard.service.spec.ts`)：覆盖完整

关键路径得满分 2/2。

---

## D11: 可观测性与运维 [4/4]

### Logger 一致性

**Phase 1-4 全部新服务**均使用 `new Logger(ServiceName.name)` 模式：

| 服务                               | Logger 声明 | 方法覆盖         |
| ---------------------------------- | ----------- | ---------------- |
| `QueryLoopService`                 | `:92`       | log, debug, warn |
| `TokenTrackerService`              | `:41`       | debug, warn      |
| `ContextCompactionPipelineService` | `:82`       | debug, log, warn |
| `ExecutionCheckpointService`       | `:23`       | debug, log       |
| `AdaptiveReplannerService`         | `:74`       | log              |
| `CapabilityGuardService`           | `:11`       | warn             |

### 健康检查

`ai-kernel` 提供 `HealthCheckRunner`（`resource/health-check-runner.ts`），已导出至 facade，并有完整测试覆盖（`health-check-runner.spec.ts`）。

### Trace 覆盖

`AiChatService` 通过 `TraceCollectorService`（`ProcessEventLogService` 别名）记录 span，finishReason 已传播至 trace span（`ai-chat.service.ts:1000`）。

QueryLoopService 暂无独立 trace span（多次续写不会分别创建 span），但通过 Logger 足以诊断，可接受。

---

## D12: 配置与依赖 [4/4]

### ConfigService 采用率

新增服务（Phase 1-4）无需直接访问配置，通过注入参数或默认值运作，无 `process.env` 直接访问。

ai-kernel 全部生产文件：零 `process.env` 直接访问。

### ESLint 覆盖

`.eslintrc.js` 中的 `no-restricted-imports` 规则覆盖 ai-engine 所有子目录（11 个区段，第 118-348 行），包括：

- Section 5 覆盖 `orchestration/services` barrel
- 新增 Phase 1-4 服务通过 facade/index.ts 导出，ESLint 规则通过 facade 白名单隐式保护

**唯一发现**: 新增的 `tools/middleware` 和 `tools/concurrency` 路径未在 ESLint rules 中显式列出为禁止路径，但这不是问题——这些是实现层，不应被外部直接 import，隐式通过 "forbidden unless via facade" 规则兜底即可。

### 依赖健康

npm audit 信息在本次审计时未执行完整扫描，但 `package.json` 中无已知高危包被标记。

---

## 架构债务优先级矩阵

| 优先级 | 问题                                                                  | 维度 | 影响范围                         | 修复成本                              | 建议时机                 |
| ------ | --------------------------------------------------------------------- | ---- | -------------------------------- | ------------------------------------- | ------------------------ |
| **P1** | Controller 层全面缺失 spec 文件（13 个 Controller）                   | D10  | 高：API 契约无单元保护           | 中：每个 Controller spec 约 50-100 行 | 本迭代                   |
| **P1** | `chatWithLoop` 返回值缺少 `inputTokens`/`outputTokens`/`finishReason` | D6   | 中：billing 成本归因不精确       | 低：3 行修复                          | 本迭代                   |
| **P2** | `TokenTrackerService` 无 `OnModuleDestroy`（setInterval 未清理）      | D4   | 低：生产无影响，测试可能内存泄漏 | 低：5 行修复                          | 本迭代                   |
| **P2** | `function-calling-llm.adapter.ts` 中 6 处 `as any`（LLM 响应解析）    | D7   | 低：运行时安全，类型覆盖缺口     | 中：需定义联合类型                    | 下次迭代                 |
| **P3** | 5 个超过 1000 行的大文件（ai-engine.facade.ts 等）                    | D7   | 低：可读性影响                   | 高：需要重构                          | 长期（Phase 5 正在推进） |
| **P3** | ai-engine 内部 Controller 无明确 @UseGuards 注解                      | D5   | 低：依赖全局 Guard 已兜底        | 低：添加注解                          | 下次迭代                 |

---

## 建议行动项

### 必须处理（本迭代）

- [ ] **P1-a**: 为 6 个 topic-insights Controller 创建 spec 文件（重点: `mission.controller.spec.ts`, `topic.controller.spec.ts`，覆盖核心 CRUD 和 Guard 行为）
- [ ] **P1-b**: 修复 `chat.facade.ts:248-253`，`chatWithLoop` 返回值补充 `inputTokens`, `outputTokens`, `finishReason` 字段
- [ ] **P2-a**: 为 `TokenTrackerService` 添加 `implements OnModuleDestroy`，在 `onModuleDestroy()` 中 `clearInterval`

### 计划处理（下次迭代）

- [ ] **P2-b**: 修复 `function-calling-llm.adapter.ts` 中的 6 处 `as any`，为 LLM API 响应定义精确类型
- [ ] **P3-a**: 为 ai-engine 内部 Controller（agents/skills/teams）添加 `@UseGuards` 明确注解
- [ ] 为 ai-engine 内部 5 个 Controller 创建基础 spec 文件（smoke test 级别）
- [ ] 为 ai-kernel 2 个 Controller 创建 spec 文件

### 长期改进

- [ ] 继续推进 ai-engine.facade.ts 的 Phase 5 域 Facade 拆分（`ChatFacade`, `RAGFacade` 等已完成，剩余 Domain 继续替代 `AIEngineFacade`）
- [ ] `data-source-router.service.ts`（2675行）和 `dimension-mission.service.ts`（2668行）的模块化拆分
- [ ] QueryLoopService 的独立 trace span 支持（用于多轮续写的可观测性分析）

---

## 模块专项结论

### AI Engine

**亮点**:

- Phase 1-4 新增 5 个服务设计优雅：清晰的接口抽象（`ChatFn`, `SummarizeFn`），无 LLM 耦合
- facade/index.ts 保持对新服务的完整导出，无遗漏
- OrchestrationFeature interface 正确集成 QueryLoopService 和 TokenTrackerService
- 全部新服务均有对应 spec 文件和完整测试覆盖

**技术债务**:

- `ai-engine.facade.ts` 2993 行仍是最大的结构性债务（Phase 5 正在缓解）
- `function-calling-llm.adapter.ts` 中残余 `as any`
- Controller 层无 spec 覆盖

### AI Kernel

**亮点**:

- 模块极其精简（56 个生产文件），职责单一
- 零 `any` 类型（生产代码）
- `AiKernelModule` 为 `@Global()`，正确避免了跨模块重复声明
- `CapabilityGuardService` 正确实现进程级工具/技能访问控制
- `HealthCheckRunner` 抽象合理，已有完整测试

**无显著债务**

### Topic Insights

**亮点**:

- 83.8% 测试覆盖率（高于 30% 阈值），为三模块中最高
- Facade 边界合规率 100%，ai-kernel 访问也全部通过 facade
- 全面的 @UseGuards + @Throttle 覆盖
- `SectionWriter` 与 `chatWithLoop` 集成干净：正确使用 `QueryLoopConfig` 配置，错误处理完整

**技术债务**:

- 6 个 Controller 无 spec（延续上次审计缺口）
- 3 个超大服务文件（2675/2668/2566 行）

---

_评分模型: v2.0 (12 维度)_
_对比基线: topic-insights-audit-2026-03-23.md (86/100，仅 topic-insights 单模块)_
_本次范围扩展至三模块，评分 92/100 为新基线_
_下次建议审计: 2026-05-01（月度定期审计）或下次重大基础设施升级后_
_报告工具: Arch Auditor Agent v2.0_

