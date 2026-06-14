# Topic Insights 模块全量 12 维度架构审计报告

**审计日期**: 2026-03-11
**审计版本**: 1e9056c83
**审计员**: Arch Auditor Agent v2.0
**审计范围**: `backend/src/modules/ai-app/topic-insights/` 全量代码

## 代码库基本情况

| 指标                 | 数值                                 |
| -------------------- | ------------------------------------ |
| 生产 TS 文件数       | 167                                  |
| 测试文件数           | 86                                   |
| 测试比率             | 51.5%                                |
| 超大文件（>500 行）  | 40 个                                |
| 最大文件             | research-leader.service.ts (3120 行) |
| 前 5 大文件总行数    | 12,988 行                            |
| Controller 数量      | 6                                    |
| Controller spec 覆盖 | 6/6 (100%，位于 `__tests__/` 子目录) |

---

## 执行摘要

| #   | 维度                    | 满分    | 得分   | 状态   |
| --- | ----------------------- | ------- | ------ | ------ |
| 1   | 分层合规（Facade 边界） | 15      | 15     | 合格   |
| 2   | 模块边界（依赖方向）    | 8       | 7      | 良好   |
| 3   | LLM 调用规范            | 8       | 8      | 合格   |
| 4   | 注册与生命周期          | 5       | 4      | 良好   |
| 5   | API 设计质量            | 10      | 8      | 良好   |
| 6   | 错误处理健壮性          | 10      | 7      | 待改进 |
| 7   | 代码健康度              | 10      | 4      | 严重   |
| 8   | 数据访问                | 8       | 7      | 良好   |
| 9   | 安全态势                | 10      | 8      | 良好   |
| 10  | 测试与 QA               | 8       | 6      | 待改进 |
| 11  | 可观测性                | 4       | 4      | 合格   |
| 12  | 配置与依赖              | 4       | 3      | 良好   |
|     | **总计**                | **100** | **81** |        |

---

## D1: 分层合规（Facade 边界）[15/15]

**结论：零违规，完全合规。**

扫描范围：topic-insights 内所有非测试 TS 文件中 `from.*ai-engine` 的导入。

所有 AI Engine 访问均通过 Facade 路径：

- `@/modules/ai-engine/facade` — ChatFacade、AgentFacade、ToolFacade、TraceCollectorService、TeamFacade 等
- `@/modules/ai-infra/facade` — BillingContext、EmailService、SettingsService、ErrorTrackingService、AIMetricsService、R2StorageService
- `@/modules/ai-kernel/facade` — CostAttributionService、EventBusService、CircuitBreakerService

未发现任何穿透内部路径的导入（如 `ai-engine/tools/registry/...`、`ai-engine/llm/...`）。动态 `import()` 绕过 Facade 的情况亦未发现。

模块本身只通过 `AiEngineModule` 整体引入，无法从 Engine 内部挑选单个 Provider。

---

## D2: 模块边界（依赖方向）[7/8]

### 正面情况

- topic-insights 未反向依赖 ai-engine（ai-engine 不 import ai-app）
- 未发现跨 ai-app 子模块的直接 import（research、teams、writing 等相互隔离）
- 使用 `EventEmitter2` 实现 `ResearchEventEmitterService`，通过事件总线解耦循环依赖，设计合理

### 已知问题（-1 分）

**forwardRef 依赖环过于密集**，体现了尚未彻底消除的设计债务：

| 依赖对                                                | 方向       | 说明                                                           |
| ----------------------------------------------------- | ---------- | -------------------------------------------------------------- |
| `MissionLifecycleService` ↔ `ResearchLeaderService`   | forwardRef | Lifecycle 触发 Leader 规划；LeaderTool 触发 Lifecycle 创建任务 |
| `MissionLifecycleService` ↔ `MissionQueryService`     | forwardRef | 双向状态读取                                                   |
| `MissionLifecycleService` ↔ `MissionExecutionService` | forwardRef | Lifecycle 启动 Execution                                       |
| `MissionExecutionService` ↔ `ResearchMemoryService`   | forwardRef | 执行存记忆；记忆指导执行策略                                   |
| `MissionQueryService` ↔ `ResearchLeaderService`       | forwardRef | —                                                              |
| `DimensionMissionService` ↔ `ResearchLeaderService`   | forwardRef | —                                                              |
| `DimensionWritingService` ↔ `ResearchLeaderService`   | forwardRef | —                                                              |
| `ResearchTodoService` ↔ `ResearchLeaderService`       | forwardRef | —                                                              |

共 **8 对 forwardRef**，其中 5 对集中在 `ResearchLeaderService` 作为被依赖节点，说明该服务是整个模块的"引力中心"——任何代码若需调用 Leader 的能力都拉着循环依赖来。根本原因是 ResearchLeaderService (3120 行) 集成了规划、审核、大纲生成、用户消息解码等多项职责。

---

## D3: LLM 调用规范 [8/8]

**结论：完全合规。**

全量扫描结果：

- 零硬编码模型名（`model: "gpt-4o"` 等）
- 零硬编码 `temperature`、`maxTokens`
- 所有 LLM 调用均通过 `ChatFacade`（从 `@/modules/ai-engine/facade` 导入），共 15 处引用
- 未发现直接使用 `new OpenAI()`、`new Anthropic()` 等 SDK
- fallback/default 场景统一使用空字符串 `""` 而非具体模型名

---

## D4: 注册与生命周期 [4/5]

### 正面情况

`TopicInsightsModule.onModuleInit()` 执行了完整的注册链：

1. `promptSkillBridge.registerDomain("insights")` — Skill 注册
2. `connectorRegistry.register(...)` — 4 个数据源连接器注册
3. `agentRegistry.register(topicInsightsAgent)` — Agent 注册
4. `teamRegistry.registerConfig(TOPIC_INSIGHTS_TEAM_CONFIG)` — Team 注册

使用 `@Optional()` 修饰 agentRegistry 和 teamRegistry，防止 Registry 未加载时启动失败，符合降级设计原则。

### 问题（-1 分）

**forwardRef 注释质量参差不齐**。大多数 forwardRef 有单行说明，如：

```
// forwardRef: MissionLifecycleService <-> ResearchLeaderService
// Lifecycle calls Leader to plan research; Leader adjusts dimensions via LeaderToolService which triggers Lifecycle task creation
```

但 `DimensionWritingService ↔ ResearchLeaderService` 和 `ResearchTodoService ↔ ResearchLeaderService` 的 forwardRef 仅有一行简短说明，缺乏"为何不能通过事件总线解耦"的决策说明，将来可能被误删。

---

## D5: API 设计质量 [8/10]

### 正面情况

**DTO 校验覆盖率高**（337 个 class-validator 装饰器调用）。抽查 `CreateTopicDto`：

- `@IsString() @IsNotEmpty() @MaxLength(200)` 覆盖所有用户输入字段
- `@IsEnum(ResearchTopicType)` 覆盖枚举类型
- `@ValidateNested({ each: true }) @Type(...)` 正确处理嵌套对象数组

**Swagger 文档**：所有 6 个 Controller 均有 `@ApiTags("Topic Research")`、`@ApiBearerAuth("access-token")`，关键端点有 `@ApiOperation`、`@ApiParam`、`@ApiResponse`。

**Auth Guard**：

- Controller 级别统一 `@UseGuards(JwtAuthGuard)`
- 敏感端点加 `@UseGuards(TopicAccessGuard) @RequireTopicAccess(CollaboratorRole.EDITOR)`
- 公开端点使用 `@Public()` 明确标注

**限流**：AI 密集型端点（leaderPlan: 10次/分钟）和公开端点（30次/分钟）均有 `@Throttle`。

### 问题（-2 分）

**P1: report.controller.ts 存在 7 处 `// TODO: Implement` 注释**（-1 分）

```typescript
// TODO: Implement listReports
return this.topicResearchService.listReports(userId, id, query);

// TODO: Implement getLatestReport
return this.topicResearchService.getLatestReport(userId, id);
// ...（共 7 处）
```

这些 TODO 注释本身不影响功能（实际已委托到 Service），但：

1. 注释传递了"未完成"信号，误导维护者
2. 掩盖了 Controller 与 Service 职责边界不清的问题

**P2: `MissionController.leaderChat` 业务逻辑过重**（-1 分）

Controller 层手动做了 TODO 创建、Agent 分配、LeaderPlan 更新、消息保存等步骤（约 120 行），违反 "Controller 只做路由和入参校验" 的 Thin Controller 原则。这些逻辑应归属于 `MissionLifecycleService` 或专用的 `LeaderChatService`。

---

## D6: 错误处理健壮性 [7/10]

### 正面情况

- 142 处使用 NestJS 标准异常（`NotFoundException`、`BadRequestException`、`InternalServerErrorException`、`ServiceUnavailableException` 等）
- `research-leader.service.ts` 中对 `[INSUFFICIENT_CREDITS]`、`[CONTEXT_TOO_LONG]` 做了语义化错误标记并区分重试策略
- `MissionExecutionService` 使用 CAS 原子操作防止竞态条件
- fire-and-forget 均使用 `void` 前缀 + `.catch((err) => { this.logger.error(...) })`

### 问题 1（-2 分）：`bare throw new Error` 在内部服务中使用

共 12 处 `throw new Error(...)` 出现在 service 层（非 Controller），这些错误通过内部调用链传播，不会直接变成 HTTP 响应，但：

1. `research-leader.service.ts:2352/2362/2752/2764` — `[INSUFFICIENT_CREDITS]`、`[CONTEXT_TOO_LONG]` 用字符串前缀标记错误语义，调用方（`mission-execution.service.ts`）用 `includes()` 字符串匹配来识别错误类型。这是一种脆弱的错误分类方式，应改为自定义错误类（如 `class InsufficientCreditsError extends Error`）。
2. `section-writer.service.ts:341/665/770` — 同样的 `[INSUFFICIENT_CREDITS]` 模式。
3. `global-source-throttle.service.ts:99/118` — `"Search cancelled for ${sourceId}"` 应改为 `CancellationError`。

### 问题 2（-1 分）：31 处 `catch {}` 空捕获块

```typescript
// pubmed.connector.ts:59 — isAvailable() 中捕获网络异常
} catch {
  return false;
}
```

大多数位于合理场景（availability check、JSON 解析回退），但部分未留任何日志，排查时无迹可循。具体分布：

| 文件                                           | 数量 | 场景                      |
| ---------------------------------------------- | ---- | ------------------------- |
| prompts/dimension-research.prompt.ts           | 2    | JSON 解析回退             |
| connectors/pubmed/semantic-scholar/weather-api | 各 2 | isAvailable + healthCheck |
| data-enrichment.service.ts                     | 1    | 降级处理                  |
| data-source-fetcher.service.ts                 | 1    | 降级处理                  |
| report-synthesis.service.ts                    | 2    | 内容提取回退              |
| section-writer.service.ts                      | 1    | 内容格式化回退            |
| 其他（knowledge-graph、multi-language 等）     | 20+  | 各类降级                  |

建议：降级场景应保留 `this.logger.debug(...)` 而非完全静默。

---

## D7: 代码健康度 [4/10]

这是得分最低的维度，是全模块最大的架构债务所在。

### 严重问题 1（-4 分）：超大文件数量极多

共 **40 个文件超过 500 行**（占全部生产文件的 24%），其中：

| 文件                               | 行数 | 超出 500 行倍数 |
| ---------------------------------- | ---- | --------------- |
| research-leader.service.ts         | 3120 | 6.2x            |
| data-source-router.service.ts      | 2666 | 5.3x            |
| dimension-mission.service.ts       | 2553 | 5.1x            |
| report-synthesis.service.ts        | 2478 | 5.0x            |
| mission-execution.service.ts       | 2171 | 4.3x            |
| topic-team-orchestrator.service.ts | 1842 | 3.7x            |
| research-todo.service.ts           | 1668 | 3.3x            |
| topic-insights.service.ts          | 1623 | 3.2x            |

`research-leader.service.ts` 是主要问题：尽管已从历史上的"God Service"拆出了多个子服务，它仍包含：

- 研究规划（`planResearch`）
- 维度大纲生成（`planDimensionOutline`）
- 全局大纲生成（`planGlobalOutline`）
- 用户消息解码（`decodeUserMessage`）
- 领域上下文构建（`buildProjectContext`）
- 维度审核（`reviewDimension`）

这 6 类职责仍集中在一个文件中，是 5 对 forwardRef 的根源。

### 严重问题 2（-2 分）：236 处 TODO/FIXME/HACK 注释

236 个标注分布在生产代码中，反映了大量已知但未消化的技术债：

```typescript
// TODO: 后续添加 CrawlersModule 以支持更多数据源（module.ts）
// TODO: Implement listReports（report.controller.ts，7 处）
// FIXME: 这里应该用 LeaderChat 而不是直接调 Leader
// HACK: 临时方案，Leader 不支持流式时的降级
```

### 小问题（分数已在上述中扣除）

- `any` 类型：仅 1 处（注释行偶发），实际类型安全极佳
- `@ts-ignore / @ts-expect-error`：零处
- `console.log`：零处（全部使用 Logger）
- 硬编码品牌名：**1 处**（`figure-extractor.service.ts:775` 中 User-Agent 字符串包含 `GenesisBot/1.0; +https://genesis-ai-labs.org`）

---

## D8: 数据访问 [7/8]

### 正面情况

**事务使用规范**：关键写操作均使用 `$transaction`：

- `TopicCrudService.createTopic` — 事务内创建 topic + 默认维度
- `TopicDimensionService.reorderDimensions` — 批量排序原子操作
- `EvidenceManagementService` — 证据创建/更新使用事务
- `DimensionMissionService`、`DimensionWritingService` — 节写入使用 interactive transaction

**$queryRaw 使用安全**：5 处 `$queryRaw` 均使用 Prisma 标签模板字面量（`${userId}`、`${topicId}`），Prisma 自动参数化，无 SQL 拼接风险：

```typescript
const result = await this.prisma.$queryRaw<...>`
  SELECT rt.visibility, EXISTS(...)
  FROM research_topics rt
  WHERE rt.id = ${topicId}
`;
```

**CAS 竞态防护**：`MissionExecutionService.executeTask` 使用 `updateMany({ where: { id, status: PENDING } })` 作为原子 CAS 操作，防止多并发实例重复执行同一任务。

### 问题（-1 分）

**P2: `$queryRaw` 重复实现权限检查逻辑**

`TopicCrudService.canUserAccessTopic`（第 637 行）和 `TopicDimensionService`（第 353 行）存在几乎完全相同的 SQL 查询，都在检查用户的 topic 访问权限（visibility + collaborator）。这个逻辑应提取为单一共享方法，避免两处分别维护 SQL。

---

## D9: 安全态势 [8/10]

### 正面情况

**JWT 认证**：WebSocket Gateway 在 `afterInit` 中安装了 Socket.IO 中间件，连接前完成 JWT 验证和用户填充，`@SubscribeMessage` 处理器执行时用户信息已就绪，设计正确。

**连接限制**：每用户最多 5 个 WebSocket 连接，超出时断开最旧连接，防止资源耗尽。

**输入净化**：`sanitize()` 函数（来自 `utils/prompt-sanitizer.ts`）覆盖用户输入到 LLM 前的清洗；`prompt-injection.spec.ts` 验证了净化逻辑。

**Base64 注入防护**（已修复）：在 5 处过滤 `data:` URI，防止 base64 图片注入 LLM 提示词导致 token 爆炸。

**安全审计日志**：`security-audit-logger.ts` 记录认证成功/失败事件。

**SQL 安全**：所有 `$queryRaw` 使用 Prisma 标签模板，参数化处理，无注入风险。

### 问题 1（-1 分）：WebSocket CORS 包含硬编码域名

```typescript
// topic-insights.gateway.ts:113
const isRailway = origin?.endsWith(".railway.app");
```

这个规则在代码中硬编码了 Railway 作为生产环境，与系统其他地方通过 `CORS_ORIGINS` 环境变量管理 CORS 的方式不一致（见 `app.config.ts`）。迁移自定义域名后，此规则将失效（`genesis-ai-labs.org` 不以 `.railway.app` 结尾），需要修改代码而非配置。

应改为从 `ConfigService` 读取允许的 origin 列表，与全局 CORS 配置统一。

### 问题 2（-1 分）：User-Agent 硬编码品牌和域名

```typescript
// figure-extractor.service.ts:775
"Mozilla/5.0 (compatible; GenesisBot/1.0; +https://genesis-ai-labs.org)";
```

包含品牌名（`GenesisBot`）和生产域名（`genesis-ai-labs.org`），应通过 `APP_CONFIG.brand.*` 和 `ConfigService` 动态读取。这是两个独立问题（D7 硬编码品牌名 + D9 硬编码域名）合并在一行。

---

## D10: 测试与 QA [6/8]

### 正面情况

**测试比率优秀**：86 测试文件 / 167 生产文件 = 51.5%，远超行业常见 20-30% 水平。

**Controller 100% 覆盖**：所有 6 个 Controller 均有对应的 spec 文件（位于 `controllers/__tests__/` 目录）。

**关键路径测试**：

- `services/core/__tests__/research-event-emitter.service.spec.ts`
- `services/core/__tests__/research-strategy.service.spec.ts`
- `services/data/connectors/__tests__/*.spec.ts`（PubMed、SemanticScholar、Finance、Weather 四个连接器）
- `controllers/__tests__/mission.controller.spec.ts`

### 问题 1（-1 分）：核心高风险服务缺少单元测试

以下体量最大、逻辑最复杂的服务**无对应 spec 文件**：

| 服务                            | 行数 | 测试状态   |
| ------------------------------- | ---- | ---------- |
| `research-leader.service.ts`    | 3120 | **无测试** |
| `data-source-router.service.ts` | 2666 | **无测试** |
| `dimension-mission.service.ts`  | 2553 | **无测试** |
| `report-synthesis.service.ts`   | 2478 | **无测试** |
| `mission-execution.service.ts`  | 2171 | **无测试** |

这 5 个文件合计 12,988 行，承载了模块 90% 的核心业务逻辑，却没有任何单元测试。这意味着每次修改只能依赖全链路集成测试（需要 Railway 环境）来验证，线下无法快速回归。

### 问题 2（-1 分）：集成测试缺失

未发现任何 e2e 或集成测试文件（`*.e2e-spec.ts`），无法验证 WebSocket 实时推送链路和 Mission 全生命周期的端到端正确性。

---

## D11: 可观测性 [4/4]

**结论：满分，可观测性体系完整。**

**Logger 覆盖**：65 个 service 文件中 62 个有 `private readonly logger = new Logger(...)` 实例（95.4%）。3 个无 Logger 的文件（`research-strategy.service.ts`、`topic-schedule.service.ts`、`citation-formatting.utils.service.ts`）均为轻量工具类，无需日志。

**Trace 集成**：`MissionObservabilityService` 封装了 `TraceCollectorService`，提供 `startTrace()`、`addSpan()`，可选注入（`@Optional()`），降级不影响正常运行。

**健康检查**：`ResearchMissionHealthService` 实现了：

- 5 分钟定期检查（与 AI Writing 模块一致）
- 30 分钟卡死阈值（match LLM 实际运行时长）
- 服务启动后自动恢复中断任务
- `OnModuleInit/OnModuleDestroy` 正确启停定时器

**错误追踪和指标**：`MissionObservabilityService` 集成了 `ErrorTrackingService`、`AIMetricsService`、`CostAttributionService`，全部使用 `@Optional()` 依赖注入，降级优雅。

---

## D12: 配置与依赖 [3/4]

### 正面情况

**ConfigService 采用率高**：全模块未发现 `process.env` 直接访问，所有配置均通过 `ConfigService` 读取（`JWT_SECRET`、`NCBI_API_KEY` 等）。这是本次审计中 12 维度里最干净的一个维度之一。

**数据源连接器**：`PubMedConnector`、`SemanticScholarConnector` 均正确注入 `ConfigService` 读取 API Key。

### 问题（-1 分）

**WebSocket Gateway 的 CORS 配置绕过了统一配置机制**（与 D9 同一问题）：

```typescript
// 硬编码逻辑，无法通过环境变量调整
const isRailway = origin?.endsWith(".railway.app");
```

系统已有 `CORS_ORIGINS` 环境变量机制（`app.config.ts`），此处应复用同一机制。目前 WebSocket CORS 是独立的、不可配置的 hardcoded 逻辑，违反了"配置外置"原则。

---

## 架构债务优先级矩阵

| 优先级 | 问题                                                                                                          | 维度   | 影响范围                | 修复成本                  | 建议时机 |
| ------ | ------------------------------------------------------------------------------------------------------------- | ------ | ----------------------- | ------------------------- | -------- |
| P0     | WebSocket CORS 硬编码 `.railway.app`，自定义域名迁移后失效                                                    | D9/D12 | 生产事故风险            | 低（改几行配置读取）      | 立即     |
| P0     | `research-leader.service.ts` 无任何单元测试，3120 行高风险核心服务                                            | D10    | 回归风险极高            | 高（需大量 mock 工作）    | 立即启动 |
| P1     | `figure-extractor.service.ts` User-Agent 硬编码品牌名和生产域名                                               | D7/D9  | 品牌一致性+部署可配置性 | 低（2 行改动）            | 本迭代   |
| P1     | `MissionController.leaderChat` 120 行业务逻辑放在 Controller 层                                               | D5     | 可测试性、可维护性      | 中（需重构+移测试）       | 本迭代   |
| P1     | `throw new Error("[INSUFFICIENT_CREDITS]...")` 字符串前缀错误分类（research-leader + section-writer 各 2 处） | D6     | 错误处理健壮性          | 低（抽自定义 Error 类）   | 本迭代   |
| P1     | 权限检查 SQL 重复（`TopicCrudService` vs `TopicDimensionService`）                                            | D8     | 维护成本、一致性        | 低（提取共享方法）        | 本迭代   |
| P2     | `dimension-mission.service.ts`、`report-synthesis.service.ts`、`mission-execution.service.ts` 无单元测试      | D10    | 回归风险                | 高                        | 下次迭代 |
| P2     | `research-leader.service.ts` 仍含 6 类职责，是 5 对 forwardRef 的根源                                         | D2/D7  | 代码维护难度            | 极高（需大规模重构）      | 规划期   |
| P2     | 31 处 `catch {}` 空块，部分缺少 debug 日志                                                                    | D6     | 可排查性                | 低（逐个加 logger.debug） | 下次迭代 |
| P3     | `data-source-router.service.ts` (2666 行) 可进一步拆分                                                        | D7     | 可读性                  | 高                        | 长期     |
| P3     | 236 处 TODO/FIXME/HACK 注释需清理或 issue 化                                                                  | D7     | 技术债可见性            | 中（批量处理）            | 长期     |
| P3     | report.controller.ts 的 7 个 `// TODO: Implement` 注释应清理（逻辑已实现）                                    | D5     | 误导性                  | 极低（删注释）            | 下次迭代 |

---

## 建议行动项

### 必须处理（本迭代）

- [ ] **P0** 修复 `topic-insights.gateway.ts` WebSocket CORS：改为从 `ConfigService.get("CORS_ORIGINS")` 读取，与全局配置统一，确保自定义域名切换后 WebSocket 正常工作
- [ ] **P1** 提取 `InsufficientCreditsError`、`ContextTooLongError`、`CancellationError` 自定义错误类，替换字符串前缀匹配模式
- [ ] **P1** 修复 `figure-extractor.service.ts:775` User-Agent 硬编码，改为 `APP_CONFIG.brand.botName` + `ConfigService.get("APP_URL")`
- [ ] **P1** 将 `TopicCrudService.canUserAccessTopic` 提取为 `TopicAccessHelperService`，消除 `TopicDimensionService` 中的 SQL 重复
- [ ] **P1** 清理 `report.controller.ts` 中 7 处误导性 `// TODO: Implement` 注释（逻辑已实现）

### 计划处理（下次迭代）

- [ ] **P0/P1** 为 `research-leader.service.ts` 补充核心方法的单元测试：`planResearch()`、`decodeUserMessage()`、`planDimensionOutline()` 各至少 3 个测试用例
- [ ] **P1** 将 `MissionController.leaderChat` 中的 TODO 创建/Agent 分配/消息保存逻辑下沉到 `MissionLifecycleService.handleLeaderChat()` 方法
- [ ] **P2** 为 `mission-execution.service.ts`、`report-synthesis.service.ts` 补充基础单元测试
- [ ] **P2** 清理 31 处空 `catch {}` 块：降级场景保留 `this.logger.debug(...)` 记录原因

### 长期改进（规划期）

- [ ] **P2** 制定 `research-leader.service.ts` 职责拆分路线图：将 `planDimensionOutline`/`planGlobalOutline` 迁移到独立的 `DimensionPlannerService`，将 `decodeUserMessage` 迁移到 `LeaderIntentService`，逐步消除 5 对 forwardRef
- [ ] **P3** `data-source-router.service.ts` (2666 行) 按搜索渠道（web/academic/social/finance）拆分到独立 service
- [ ] **P3** 将 236 处 TODO/FIXME/HACK 批量转化为 GitHub Issues 并关联项目看板，防止技术债隐形积累

---

## 审计亮点（值得在其他模块复用的模式）

1. **Facade 边界零违规**：69 处跨层导入全部通过正确 Facade 路径，是其他 ai-app 模块的基准对照
2. **BillingContext 传播设计**：在异步 fire-and-forget 链中通过 `BillingContext.run(existingCtx, ...)` 保持积分上下文传播，处理了常见的 AsyncLocalStorage 丢失问题
3. **CAS 竞态防护**：`updateMany({ where: { id, status: PENDING } })` 原子状态切换，防止并发重复执行任务，简洁有效
4. **事件总线解耦**：用 `EventEmitter2` 实现 `ResearchEventEmitterService`，部分替代了 forwardRef，是减少循环依赖的可扩展路径
5. **连接器注册模式**：`DataSourceConnectorRegistry` + `IDataSourceConnector` 接口，新增数据源无需修改核心代码，符合开闭原则
6. **Base64 注入防护**：在 evidence 摘要构建的 5 个层面（evidence-summary.utils、section-writer x2、figure-relevance x2）过滤 `data:` URI，防御纵深充足
7. **健康检查与自愈**：`ResearchMissionHealthService` 实现了启动恢复、周期检查、任务级卡死检测三级保障，可作为其他长时任务模块的参考实现

---

_评分模型: v2.0 (12 维度)_
_前次审计: `topic-insights-audit-2026-03-07.md` (不可直接比较，范围不同)_
_下次建议审计: 2026-04-11_
_报告工具: Arch Auditor Agent v2.0_

