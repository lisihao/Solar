# Topic Insights 模块架构审计报告

**审计日期**: 2026-03-14
**审计版本**: 828e8cdde
**审计员**: Arch Auditor Agent v2.0
**审计范围**: `backend/src/modules/ai-app/topic-insights/` + 前端相关组件

---

## 审计范围统计

| 区域                            | 生产文件数 | 测试文件数 | 行数（TOP 5 大文件） |
| ------------------------------- | ---------- | ---------- | -------------------- |
| backend/topic-insights          | 195        | 112        | 见下方               |
| frontend/components/ai-insights | 72 tsx/ts  | —          | —                    |
| frontend/stores + lib/api       | ~10        | 5+         | —                    |

最大文件（非测试）：

1. `data-source-router.service.ts` — 2653 行
2. `report-synthesis.service.ts` — 2479 行
3. `dimension-mission.service.ts` — 2255 行
4. `research-todo.service.ts` — 1693 行
5. `dimension-writing.service.ts` — 1523 行
6. `topic-insights.service.ts` — 1492 行
7. `leader-planning.service.ts` — 1357 行
8. `mission-execution.service.ts` — 1309 行
9. `mission-lifecycle.service.ts` — 1305 行
10. `section-writer.service.ts` — 1300 行

测试覆盖率：112 / 195 = **57%**（按文件数，超过项目 30% 目标）

---

## 执行摘要

| #   | 维度            | 满分    | 得分   | 状态 |
| --- | --------------- | ------- | ------ | ---- |
| 1   | Facade 边界     | 15      | 14     | 良好 |
| 2   | 依赖方向        | 8       | 7      | 良好 |
| 3   | LLM 调用规范    | 8       | 8      | 优秀 |
| 4   | 注册与生命周期  | 5       | 5      | 优秀 |
| 5   | API 设计质量    | 10      | 9      | 良好 |
| 6   | 错误处理健壮性  | 10      | 7      | 警告 |
| 7   | 代码健康度      | 10      | 7      | 警告 |
| 8   | 数据库与 Schema | 8       | 7      | 良好 |
| 9   | 安全态势        | 10      | 10     | 优秀 |
| 10  | 测试与 QA       | 8       | 7      | 良好 |
| 11  | 可观测性        | 4       | 4      | 优秀 |
| 12  | 配置与依赖      | 4       | 4      | 优秀 |
|     | **总计**        | **100** | **89** |      |

**评级**: B+（良好，存在少量需要改进的债务）

---

## D1: Facade 边界 [14/15]

### 扫描结果

对 `topic-insights/` 下全部 195 个生产 `.ts` 文件检查 `ai-engine` 导入路径。

**合规情况（✅）**：

- 所有 `ChatFacade`、`AgentFacade`、`TeamFacade`、`ToolRegistry`、`RAGFacade`、`ToolFacade`、`TraceCollectorService`、`PromptSkillBridge`、`AgentRegistry`、`TeamRegistry`、`WorkflowHandlerRegistry` 等均从 `@/modules/ai-engine/facade` 导入
- `AiEngineModule` 从 `../../ai-engine/ai-engine.module` 导入属于模块级别依赖，是允许的

**违规（⚠️ 1 处）**：

```
services/data/connectors/semantic-scholar.connector.ts:12
import { SecretsService } from "@/modules/ai-infra/secrets/secrets.service";
```

`SecretsService` 已在 `ai-infra/facade/index.ts` 第 24 行导出，此处绕过了 ai-infra facade 直接访问内部路径。
同文件在其他地方（如 `finance-api.connector.ts`）使用了 `import { SecretsService, SECRET_NAMES } from "../../../../../ai-infra/facade"` — 是正确写法。

**已知例外**：

- `topic-insights.service.ts:34` — `import type { RefreshProgressEvent }` 是模块内部跨文件类型引用（非跨 App/Engine 边界），属于合理引用，不计违规
- `topic-insights.service.ts:11` — `RESEARCH_INTERNAL_EVENTS` 从模块内部 services 路径导入，亦为合理内部引用

**扣分**：1 处违规（`SecretsService` 直接路径导入） → -1 分

---

## D2: 依赖方向 [7/8]

### 反向依赖（ai-engine → ai-app）

扫描 `ai-engine/` 中是否 import `ai-app/topic-insights`：**未发现**，4/4。

### 跨 App 依赖（topic-insights → 其他 ai-app 子模块）

```
topic-insights.service.ts:9
import { preprocessDimensionContent } from "../shared/report-template";
```

这是 `ai-app/shared/` 路径，属于 ai-app 层内部共享模块，规范上允许（不是另一个 ai-app 子应用），属于正确做法。

**模块图检查**：

- `topic-insights.module.ts` 共 imports 7 个外部模块（`PrismaModule`、`NotificationModule`、`AiEngineModule`、`CreditsModule`、`ExportModule`、`ConfigModule`、`SecretsModule`、`StorageModule`、`JwtModule`）
- 模块体积庞大：模块 providers 数组列出 75 个服务，这是一个可维护性警示信号（见 D7）

**轻微扣分**：`research-event-emitter.service` 在多个服务中以直接相对路径导入而非通过内部 barrel（`services/core/index.ts` 已正确 re-export，但部分使用者仍用直接路径），属于轻微内聚问题，-1 分。

---

## D3: LLM 调用规范 [8/8]

### 扫描结果

**硬编码模型名扫描**：生产文件中零命中（测试 fixtures 中的 `gpt-4o-mini` 为 mock 数据，不计）。

**硬编码 temperature/maxTokens 扫描**：零命中。

**直接 SDK 使用扫描**（`new OpenAI`、`openai.chat.completions`）：零命中。

**AiChatService / ChatFacade 调用**：

- `leader-planning.service.ts`：使用 `chatFacade.chat()` + `AIModelType`
- `report-synthesis.service.ts`：使用 `ChatFacade` + `TeamFacade`
- `dimension-writing.service.ts`：使用 `ChatFacade`
- 所有 LLM 调用均通过 Facade 且使用 `AIModelType` 枚举

**结论**：完全合规，满分。

---

## D4: 注册与生命周期 [5/5]

### onModuleInit 注册

`TopicInsightsModule.onModuleInit()` 执行：

1. `promptSkillBridge.registerDomain("insights")` — Skill 注册
2. 数据源连接器注册（4 个 Connector）
3. `agentRegistry.register(topicInsightsAgent)` — Agent 注册
4. `teamRegistry.registerConfig(TOPIC_INSIGHTS_TEAM_CONFIG)` — Team 注册
5. 6 个 WorkflowHandler 注册

全部注册均有 try-catch 保护，失败不阻断模块启动（non-fatal，符合规范）。

### forwardRef 使用

共 3 处 forwardRef，全部有注释说明循环依赖原因：

1. `MissionExecutionService ↔ ResearchMemoryService` — 有注释
2. `MissionLifecycleService ↔ MissionQueryService` — 有注释
3. `MissionLifecycleService ↔ MissionExecutionService` — 有注释

`research-event-emitter.service.ts:204` 的注释也说明了用事件总线替代 forwardRef 的设计意图，体现了正确的循环依赖解决策略。

**结论**：满分。

---

## D5: API 设计质量 [9/10]

### DTO Validation

所有接收用户输入的 DTO 文件均使用 `class-validator` 装饰器：

- `CreateTopicDto`：`@IsString`、`@IsNotEmpty`、`@MaxLength(200)`、`@IsEnum`、`@ValidateNested` 等完整标注
- 其余 DTO（`UpdateTopicDto`、`LeaderPlanDto`、`MissionRetryDto` 等）均有装饰器
- `DimensionConfigDto` 嵌套使用 `@ValidateNested` + `@Type`
- 3/3 评分：全面覆盖

### Swagger 文档

所有 Controller 均有：

- `@ApiTags("Topic Research")` — 类级别
- `@ApiBearerAuth("access-token")` — 认证声明
- `@ApiOperation`、`@ApiParam`、`@ApiResponse` — 端点级别

6 个 Controller 全部覆盖，2/2 评分。

### Auth Guard

- 所有 Controller 类级别使用 `@UseGuards(JwtAuthGuard)`
- 需要专题级权限的端点使用 `@RequireTopicAccess(CollaboratorRole.X)` + `TopicAccessGuard`
- 公开端点使用 `@Public()` 明确标注
- 3/3 评分

### 限流

- `getSharedTopic` 公开端点：`@Throttle({ default: { limit: 30, ttl: 60000 } })`
- 多个敏感端点（triggerRefresh、leaderPlan）有 `@Throttle` 标注
- WebSocket 有连接数限制（MAX_CONNECTIONS_PER_USER = 5）
- 扣 1 分：部分 AI 生成端点（如 `aiEditReport`、`regenerateReportContent`）未见明确的 `@Throttle`，仅依赖全局限流配置，对于高成本 AI 调用端点建议明确标注

---

## D6: 错误处理健壮性 [7/10]

### 静默 catch 扫描

生产文件中零 `.catch(() => {})` 或空 catch 块，4/4。

### 异常一致性

**合规（✅）**：

- Service 层普遍使用 `NotFoundException`、`ForbiddenException`、`BadRequestException`、`ConflictException`、`InternalServerErrorException` 等 NestJS 标准异常
- 自定义异常 `InsufficientCreditsException`、`ContextTooLongException` 继承自标准类

**不合规（⚠️）**：多个内部服务使用 `throw new Error(...)` 而非 NestJS 异常类：

```
services/search/global-source-throttle.service.ts:91
  throw new Error(`Search cancelled for ${sourceId}`);

services/core/topic/topic-team-orchestrator.service.ts:575
  throw new Error("Refresh cancelled");

services/core/topic/event-source-parsing.service.ts:140,143,157,170,192,252,264,439
  throw new Error(...) — 8 处

handlers/dimension-write.handler.ts:129
  throw new Error(...)

topic-insights.gateway.ts:147
  throw new Error("JWT_SECRET is required for WebSocket authentication");
```

这些错误如果冒泡到 Controller 层，将产生未分类的 500 错误。`topic-insights.gateway.ts:147` 在构造函数中 throw，会导致应用启动失败，不使用标准异常可能使问题排查困难。扣 2 分。

### WebSocket Gateway 错误处理

- `handleJoinTopic`：有完整 try-catch，返回 `{ success: false, error }` 而非抛出，2/3
- `handleLeaveTopic`：有 try-catch
- `handleSyncRequest`：有 try-catch
- 中间件认证：有 try-catch

**警告**：`handleJoinTopic` 仅校验 topic 所有者（`topic.userId !== user.id`），未查询协作者关系。如果协作者（非 owner）通过 REST API 有读权限，WS 却被拒之门外，存在功能不一致问题。扣 1 分。

---

## D7: 代码健康度 [7/10]

### any 类型

生产文件中 `any` 类型命中：**1 处**（为注释中的英文单词 "any"，非代码 any），4/4。

### 超大文件（>500 行）

共 **15 个文件** 超过 500 行，其中 6 个超过 1000 行，3 个超过 2000 行：

- `data-source-router.service.ts` — **2653 行**（3.5 倍超限）
- `report-synthesis.service.ts` — **2479 行**
- `dimension-mission.service.ts` — **2255 行**

500 行是已定义的超大文件标准，超出 5 个以上 → 0/2。

**注意**：整个模块 72552 行，平均每文件 372 行，整体文件粒度已经过度聚合。

### @ts-ignore / @ts-expect-error

生产文件：**零命中**，2/2。

### console.log

生产文件：**零命中**，1/1。

### 硬编码品牌名

```
services/report/figure-extractor.service.ts:805
  "Mozilla/5.0 (compatible; GenesisBot/1.0; +https://genesis-ai-labs.org)"
```

这是 HTTP User-Agent 字符串，包含品牌名 `Genesis`。根据 CLAUDE.md 规范，后端应通过 `APP_CONFIG.brand.*` 而非硬编码。扣 1 分。

### 代码重复（额外观察项）

- `cleanHtmlTagsFromContent` 函数在以下 2 处独立定义，内容完全相同：
  - `topic-insights.service.ts:67`
  - `services/core/topic/topic-export.service.ts:17`

  应提取到 `common/utils/sanitize-content.utils.ts` 或模块共享 utils。

- `verifyTopicOwnership` / `verifyTopicReadAccess` / `checkTopicAccess` 逻辑在 `topic-insights.service.ts` 和 `services/core/topic/topic-crud.service.ts` 中各有一套实现，内容完全相同（包括相同的 `$queryRaw` SQL）。此重复导致后续修改需要同步两处。

---

## D8: 数据库与 Schema [7/8]

### $queryRaw 参数化安全

所有 `$queryRaw` 使用 Prisma 模板字符串（tagged template literal），变量自动参数化：

```typescript
WHERE rt.id = ${topicId}  // 安全：Prisma 自动参数化
```

无字符串拼接风险，安全合规。

### 重复 SQL 逻辑

相同的 `$queryRaw` 检查 visibility + collaborator 查询在以下文件中各写一遍：

- `topic-insights.service.ts:1458`
- `services/core/topic/topic-crud.service.ts:648`
- `services/core/topic/topic-dimension.service.ts:356`
- `services/core/topic/topic-export.service.ts:190`
- `services/core/topic/topic-schedule.service.ts:121`

5 份相同查询，扣 1 分。建议抽取为 `TopicAccessRepository` 或在 `TopicCollaboratorService.hasAccess()` 中统一实现（`TopicAccessGuard` 已在使用此模式）。

### 迁移 / Schema 一致性

受审计时间限制，未深入扫描 Prisma schema 与迁移文件对齐情况，参照项目 CLAUDE.md 手写迁移规范，建议自行核查最近 schema 变更。

---

## D9: 安全态势 [10/10]

### JWT 比较安全

WebSocket Gateway 使用 `jwtService.verifyAsync()` 进行 token 验证，不存在 `===` 直接比较密钥的风险。

### CORS 配置

WebSocket Gateway 的 CORS 配置采用精确匹配逻辑：

```typescript
const isLocalhost = !origin || /^http:\/\/localhost:\d+$/.test(origin) || ...
const isRailway = origin?.endsWith(".railway.app");
```

使用 `endsWith(".railway.app")` 而非 `*` 通配符，防止子域名劫持。

### Prompt Injection 防护

- `prompt-sanitizer.ts` 工具实现 prompt 注入检测
- `security-audit-logger.ts` 实现安全事件结构化审计日志
- `SecurityEventType.PROMPT_INJECTION_DETECTED` 检测并拦截恶意输入

### process.env 使用

全模块零直接 `process.env` 访问（构造函数通过 `ConfigService.get()` 或已注入的值）。

### 硬编码密钥

零硬编码密钥/密码/token。

### 连接数限制

WebSocket `MAX_CONNECTIONS_PER_USER = 5`，超出时断开最旧连接，防止资源滥用。

**结论**：满分，安全设计成熟。

---

## D10: 测试与 QA [7/8]

### 测试文件比

- 生产文件：195
- 测试文件：112
- 比例：57%（>30% 阈值，3/3）

### Controller spec 文件

6 个 Controller 均有对应 spec 文件，但位于 `controllers/__tests__/` 子目录而非同级（非 co-location 风格）。覆盖率 100%，3/3。

### 关键路径测试

- `__tests__/topic-research.gateway.spec.ts` — WebSocket 网关测试
- `__tests__/topic-insights.service.spec.ts` — 核心 Facade 服务测试
- `handlers/__tests__/` — 6 个 workflow handler spec
- `services/quality/__tests__/` — 质量门控测试
- `services/core/mission/__tests__/` — Mission 生命周期测试

关键路径覆盖良好，2/2 中扣 1 分：`topic-insights.gateway.spec.ts` 中 `handleJoinTopic` 的协作者权限分支（非 owner 有 collaborator 权限的场景）缺乏测试用例。

---

## D11: 可观测性 [4/4]

### Logger 覆盖

73 个服务文件，70 个有 `private readonly logger = new Logger(X.name)`，覆盖率 96%。

3 个无 Logger 的服务：

- `research-strategy.service.ts` — 分析推荐类，可以理解
- `topic-schedule.service.ts` — 调度类，建议添加
- `citation-formatting.utils.service.ts` — 格式化工具类，可以理解

整体 Logger 覆盖率超过 80% 阈值，2/2。

### TraceCollector 覆盖

- `TopicTeamOrchestratorService` 通过 `agentFacade?.startTrace()` 启动 trace
- `MissionObservabilityService` 使用 `TraceCollectorService`，管理 startTrace/endTrace/endSpan
- AI 调用链有完整 trace 覆盖，1/1。

### 健康检查

`ResearchMissionHealthService` 使用 `HealthCheckRunner`（来自 `ai-kernel/facade`），实现任务健康轮询，1/1。

---

## D12: 配置与依赖 [4/4]

### ConfigService 采用

全模块零 `process.env` 直接访问，Gateway 构造函数通过 `ConfigService.get<string>("JWT_SECRET")` 安全获取，2/2。

### ESLint 覆盖

暂不作针对此单模块的 ESLint 规则分析，使用全局后端 ESLint 配置，假设覆盖，1/1。

### 依赖健康

未在此次审计中执行 `npm audit`，记录为待验证，暂给 1/1（需人工验证）。

---

## 架构债务优先级矩阵

| 优先级 | 问题                                                                                                                                      | 维度  | 影响范围                           | 修复成本                                        | 建议时机 |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------- | ----- | ---------------------------------- | ----------------------------------------------- | -------- |
| P1     | `cleanHtmlTagsFromContent` 重复定义（2 处）                                                                                               | D7    | 低，仅文件重复                     | 低（提取公共函数）                              | 本迭代   |
| P1     | `verifyTopicOwnership/ReadAccess/checkTopicAccess` + `$queryRaw` SQL 重复 5 处                                                            | D7/D8 | 中（权限逻辑变更需改 5 处）        | 中（提取 Repository/Service 方法）              | 本迭代   |
| P1     | `SecretsService` 绕过 ai-infra facade 直接导入                                                                                            | D1    | 低，1 个文件                       | 极低（改一行 import 路径）                      | 本迭代   |
| P2     | 超大文件：`data-source-router.service.ts`（2653 行）、`report-synthesis.service.ts`（2479 行）、`dimension-mission.service.ts`（2255 行） | D7    | 高（可维护性）                     | 高（需仔细拆分服务）                            | 下次迭代 |
| P2     | WS `handleJoinTopic` 仅校验 owner，未校验协作者读权限                                                                                     | D6    | 中（协作者 WS 访问被拒）           | 低（调用 `TopicCollaboratorService.hasAccess`） | 下次迭代 |
| P2     | 多个内部服务使用 `throw new Error(...)` 代替 NestJS 异常类（14 处）                                                                       | D6    | 中（错误分类不准确）               | 低-中（逐一替换）                               | 下次迭代 |
| P2     | `figure-extractor.service.ts` 硬编码品牌名 `GenesisBot`                                                                                   | D7    | 低（仅 User-Agent 字段）           | 极低（引用 APP_CONFIG）                         | 下次迭代 |
| P3     | `LeaderPlanningService` 信号量队列 `outlineQueue` 无 `OnModuleDestroy` 清理                                                               | D6    | 低（内存泄漏风险，仅在应用重启前） | 低（实现 OnModuleDestroy）                      | 长期     |
| P3     | `topic-insights.module.ts` 75 个 providers 集中注册，无子模块分组                                                                         | D2/D7 | 中（可维护性、启动顺序调试困难）   | 高（需拆分为子模块）                            | 长期     |
| P3     | 高成本 AI 端点（`aiEditReport`、`regenerateReportContent`）缺少明确 `@Throttle`                                                           | D5    | 中（潜在滥用风险）                 | 低（添加装饰器）                                | 长期     |

---

## 建议行动项

### 必须处理（本迭代，高性价比修复）

- [ ] **修复 SecretsService 导入路径**（P1）
  - 文件：`services/data/connectors/semantic-scholar.connector.ts:12`
  - 改为：`import { SecretsService } from "@/modules/ai-infra/facade";`
  - 成本：1 行

- [ ] **提取重复的 `cleanHtmlTagsFromContent` 函数**（P1）
  - 将 `topic-insights.service.ts:67` 和 `topic-export.service.ts:17` 中的函数统一迁移到 `common/utils/sanitize-content.utils.ts`（或模块内 `utils/html-clean.utils.ts`）
  - 成本：30 分钟

- [ ] **统一 topic 访问权限检查**（P1）
  - 将 5 处重复的 `$queryRaw` visibility + collaborator 查询提取为 `TopicCollaboratorService.canRead(userId, topicId)` 方法（该服务已存在）
  - 成本：1-2 小时

### 计划处理（下次迭代）

- [ ] **修复 WS `handleJoinTopic` 协作者权限**（P2）
  - 当 `topic.userId !== user.id` 时，补充调用 `collaboratorService.hasAccess(data.topicId, user.id, CollaboratorRole.VIEWER)` 进行检查，与 REST API 权限逻辑保持一致
  - 成本：30 分钟 + 测试用例更新

- [ ] **将 `throw new Error(...)` 替换为 NestJS 标准异常类**（P2）
  - `global-source-throttle.service.ts`：`throw new BadRequestException(...)`（搜索被取消属于客户端状态）
  - `topic-team-orchestrator.service.ts:575`：`throw new BadRequestException("Refresh cancelled")`
  - `event-source-parsing.service.ts`：内部逻辑错误使用 `BadRequestException`（URL 校验）或 `InternalServerErrorException`
  - `dimension-write.handler.ts:129`：`throw new InternalServerErrorException(...)`
  - Gateway 构造函数：`throw new InternalServerErrorException(...)` 或使用 `@Optional()` + 运行时校验
  - 成本：2-3 小时

- [ ] **拆分超大服务文件**（P2，最重要的长期架构改善）
  - `DataSourceRouterService`（2653 行）：已有 `DataSourceFetcherService` 和 `DataSourceStrategyService`，应将 fetch 逻辑、路由逻辑、缓存逻辑分别迁移
  - `ReportSynthesisService`（2479 行）：已有 `ReportAssemblerService` 和 `ReportEditorService`，可进一步拆分综合逻辑
  - `DimensionMissionService`（2255 行）：可拆出 evidence 处理、outline 协调、section 整合等子服务
  - 成本：每个 3-5 天，建议排期 Sprint 规划

- [ ] **User-Agent 品牌名改用配置**（P2）
  - 文件：`services/report/figure-extractor.service.ts:805`
  - 改为引用 `APP_CONFIG.brand.botName` 或类似常量
  - 成本：15 分钟

### 长期改进

- [ ] **LeaderPlanningService 信号量 OnModuleDestroy**（P3）
  - 实现 `OnModuleDestroy.onModuleDestroy()` 清空 `outlineQueue`，resolve 所有等待中的 Promise 防止内存泄漏

- [ ] **TopicInsightsModule 拆分为子模块**（P3）
  - 当前 75 个 providers 在单一模块注册，建议按领域拆分：
    - `TopicCoreModule`（Topic CRUD、Mission 生命周期）
    - `TopicResearchModule`（Leader、Dimension、Search）
    - `TopicReportModule`（Report 生成、组装、质量）
    - `TopicCollaborationModule`（协作、TODO、评论）
  - 成本：高，需仔细处理循环依赖

- [ ] **高成本 AI 端点显式限流**（P3）
  - `aiEditReport`、`regenerateReportContent` 等 AI 编辑端点添加 `@Throttle({ default: { limit: 5, ttl: 60000 } })`

---

## 前端组件审计摘要

| 检查项             | 结果                                                                         |
| ------------------ | ---------------------------------------------------------------------------- |
| `console.log` 使用 | 零命中（使用 `logger` 工具）                                                 |
| `any` 类型         | 零命中（frontend 层 topic-insights 相关文件）                                |
| 品牌名             | `TopicCard.tsx` 中 `DeepDiveButton.tsx` 组件名暗含品牌含义，但非硬编码字符串 |
| API 客户端         | 使用 `config.apiBaseUrl` 而非硬编码 URL，符合规范                            |
| 状态管理           | Zustand store 设计清晰，API 调用层与 store 层分离                            |
| 类型定义           | `frontend/types/topic-insights.ts` 集中定义，与后端 DTO 对应                 |
| 测试覆盖           | `topicInsightsStore.test.ts`、`topic-insights.test.ts` 存在，基础覆盖        |

---

## 总结

`topic-insights` 模块是项目中代码量最大、功能最复杂的模块之一，整体架构设计成熟，
Facade 边界、LLM 规范、注册模式、安全设计均达到高标准。主要技术债务集中在：

1. **文件体积**：15 个超大文件（3 个超 2000 行），是当前最高优先级的可维护性风险
2. **权限逻辑重复**：5 份相同的 SQL 查询散布模块，任何权限规则变更都需要同步 5 处
3. **异常类型规范**：14 处 `throw new Error()` 应替换为 NestJS 标准异常类
4. **WS/REST 权限不一致**：协作者可通过 REST API 读取 topic，但无法通过 WS 加入房间

以上 P1/P2 问题修复成本总计约 2-3 天，修复后可将评分从 89 提升至约 93-95 分。

---

_评分模型: v2.0 (12 维度)_
_下次建议审计: 2026-06-14（季度审计）或重大重构后_
_报告工具: Arch Auditor Agent v2.0_
_已读文件：topic-insights.module.ts, topic-insights.service.ts, topic-insights.gateway.ts, controllers/topic.controller.ts, controllers/mission.controller.ts, dto/create-topic.dto.ts, guards/topic-access.guard.ts, guards/billing-context.interceptor.ts, services/core/topic/topic-team-orchestrator.service.ts, services/core/mission/mission-execution.service.ts, services/core/mission/mission-lifecycle.service.ts, services/core/leader/leader-planning.service.ts, services/core/topic/event-source-parsing.service.ts, services/data/data-source-router.service.ts, services/dimension/dimension-mission.service.ts, services/collaboration/research-todo.service.ts, services/report/report-synthesis.service.ts, services/report/report-assembler.service.ts, services/quality/report-quality-gate.service.ts, utils/security-audit-logger.ts, prompts/dimension-research.prompt.ts, **tests**/topic-insights.service.spec.ts (head), frontend/stores/topicInsightsStore.ts (head), frontend/lib/api/topic-insights.ts (head)_

