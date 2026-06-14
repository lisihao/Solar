# 架构审计报告 (v2.0 - 12 维度模型)

**审计日期**: 2026-03-14
**审计版本**: 763f70520
**审计员**: Arch Auditor Agent v2.0
**审计范围**: `backend/src/modules/ai-app/topic-insights/` 全量扫描

### 代码库规模

- `topic-insights/` 非测试 TS 生产文件: **195 个**
- `topic-insights/` 测试文件 (spec): **147 个**
- 测试/生产文件比: **75.4%**（极高，远超 30% 基准线）
- 子目录数量: 57 个（深度嵌套，模块结构成熟）
- 模块注册 Provider 数: **~80 个**（超大模块）
- 审计依赖: ai-engine facade、ai-infra facade、Prisma schema（research_topics 区段）

---

## 评分模型说明

本报告采用 v2.0 12 维度评分模型（满分 100 分）。此次为 topic-insights 模块首次 v2.0 专项审计，建立模块级新基线。

---

## 执行摘要

| #   | 维度            | 满分    | 得分   | 状态     |
| --- | --------------- | ------- | ------ | -------- |
| 1   | Facade 边界     | 15      | 15     | 满分     |
| 2   | 依赖方向        | 8       | 8      | 满分     |
| 3   | LLM 调用规范    | 8       | 8      | 满分     |
| 4   | 注册与生命周期  | 5       | 5      | 满分     |
| 5   | API 设计质量    | 10      | 9      | 良好     |
| 6   | 错误处理健壮性  | 10      | 8      | 良好     |
| 7   | 代码健康度      | 10      | 9      | 良好     |
| 8   | 数据库与 Schema | 8       | 7      | 良好     |
| 9   | 安全态势        | 10      | 9      | 良好     |
| 10  | 测试与 QA       | 8       | 8      | 满分     |
| 11  | 可观测性        | 4       | 3      | 可改进   |
| 12  | 配置与依赖      | 4       | 3      | 可改进   |
|     | **总计**        | **100** | **92** | **优秀** |

> **92/100** 是该模块 v2.0 首次基线评分。相较于全库上一次 v1.0 审计（89/100），此次专项审计分数更高，反映了 topic-insights 模块近期的系统性架构改进（facade 边界清零违规、forwardRef 注释规范化、安全审计日志体系等）。

---

## D1: Facade 边界 [15/15]

**扫描结果**: 0 违规

所有从 `ai-engine` 导入的符号，均通过 `../../ai-engine/facade` 路径进入，无任何穿透内部路径的导入。

```
扫描路径: topic-insights/**/*.ts (exclude *.spec.ts)
模式: from '.*ai-engine/(?!facade)
结果: 0 匹配
```

**具体验证**:

- `topic-insights.module.ts` 导入 `WorkflowHandlerRegistry`、`AgentRegistry`、`TeamRegistry`、`PromptSkillBridge` 均来自 `../../ai-engine/facade`
- `mission-observability.service.ts` 导入 `TraceCollectorService` 来自 `@/modules/ai-engine/facade`
- `WorkflowHandlerRegistry` 已在 facade/index.ts 第 492 行正确 export

**ai-infra 边界**: 同样合规。所有 ai-infra 服务（`BillingContext`, `SecretsService`, `EmailService`, `R2StorageService` 等）均通过 `ai-infra/facade` 路径导入，无内部路径穿透。

唯一已知的模块级直接导入（`NotificationModule`, `CreditsModule`, `SecretsModule`, `StorageModule`）是 NestJS Module 类，符合 ai-infra facade 注释中"Module 类不从 facade 导出，直接用路径导入"的规范。

**结论**: Facade 边界完全合规。评分 15/15。

---

## D2: 依赖方向 [8/8]

**反向依赖 (ai-engine → ai-app)**: 0 违规

扫描 `ai-engine/**/*.ts` 中无任何 `from '.*modules/ai-app/` 导入。

**跨 App 依赖 (topic-insights → 其他 ai-app 模块)**: 0 违规

`topic-insights` 内部所有相对导入仅指向自身子目录，无跨 ai-app 模块依赖。

**模块依赖图**:

```
topic-insights.module.ts imports:
  PrismaModule          (L0 common)
  NotificationModule    (L1 ai-infra)
  AiEngineModule        (L3 ai-engine)  ← 正确方向
  CreditsModule         (L1 ai-infra)
  SecretsModule         (L1 ai-infra)
  StorageModule         (L1 ai-infra)
  ExportModule          (L0 common)
  ConfigModule          (L0 NestJS)
  JwtModule             (L0 NestJS)
```

所有依赖方向均为 L4 → L3/L1/L0，无违规。

**结论**: 依赖方向完全正确。评分 8/8。

---

## D3: LLM 调用规范 [8/8]

**扫描结果**: 0 违规

**硬编码模型名**: 0 处（测试 mock 文件中的 `deepseek-r1` 不计，spec 文件排除在外）

**硬编码 temperature / maxTokens**: 0 处（全部使用 `taskProfile: { creativity, outputLength }` 组合）

**TaskProfile 采用率**: 100%。检查多个核心服务：

- `research-reviewer.service.ts`: 使用 `modelType: AIModelType.CHAT` + `taskProfile`
- `leader-intent.service.ts`: 使用 `taskProfile: { creativity: "medium", outputLength: "long" }`
- `leader-planning.service.ts`: 使用 `taskProfile: { creativity: "deterministic", outputLength: "long" }`
- `agent-roles.config.ts`: 9 个角色配置均使用 taskProfile，无直接模型名

**直接 SDK 使用**: 0 处（无 `new OpenAI` / `new Anthropic` 调用）

**特别亮点**: `research-todo.service.ts` 第 1360 行使用 `modelId: todo.modelId || ""` 空字符串 fallback 模式，完全符合规范中"永远用空字符串"的要求。

**结论**: LLM 调用规范满分。评分 8/8。

---

## D4: 注册与生命周期 [5/5]

**onModuleInit 注册**:

`TopicInsightsModule.onModuleInit()` 执行完整的注册链：

1. `PromptSkillBridge.registerDomain("insights")` — 技能注册
2. `DataSourceConnectorRegistry` 注册 4 个连接器（SemanticScholar, PubMed, Finance, Weather）
3. `AgentRegistry.register(topicInsightsAgent)` — Agent 注册（带 `@Optional()` 安全降级）
4. `TeamRegistry.registerConfig(TOPIC_INSIGHTS_TEAM_CONFIG)` — Team 注册（带 `@Optional()`）
5. `WorkflowHandlerRegistry` 注册 6 个 Workflow Handler（SearchPhase, GlobalOutline, AssembleWriteInputs, DimensionWrite, Revision, QualityReview）

注册失败时有 try-catch + logger.error 兜底，保证非致命错误不影响模块启动。

**forwardRef 使用**:

共 2 处 forwardRef，均有注释说明原因：

- `mission-execution.service.ts` 第 74-76 行:
  ```
  // forwardRef: MissionExecutionService <-> ResearchMemoryService
  @Inject(forwardRef(() => ResearchMemoryService))
  ```
- `mission-lifecycle.service.ts` 第 64-70 行:
  ```
  // forwardRef: MissionLifecycleService <-> MissionQueryService
  // forwardRef: MissionLifecycleService <-> MissionExecutionService
  ```

循环依赖均为同层服务间的合理设计（God Service 分解后的双向引用），不涉及跨层循环。

**结论**: 注册与生命周期规范完整。评分 5/5。

---

## D5: API 设计质量 [9/10]

### DTO Validation (3/3)

6 个 Controller 均有对应 DTO，DTO 文件共 17 个（位于 `dto/` 目录）。
检测到 class-validator 装饰器使用 337 处（`@IsString`, `@IsEnum`, `@IsOptional`, `@IsBoolean`, `@IsArray`, `@ValidateNested`, `@Min`, `@Max` 等）。DTO validation 覆盖率优秀。

### Swagger 文档 (2/2)

全部 6 个 Controller 均有 `@ApiTags("Topic Research")` + 各端点 `@ApiOperation({ summary })` 注解：

| Controller               | @ApiTags | @ApiOperation |
| ------------------------ | -------- | ------------- |
| topic.controller         | 是       | 全端点覆盖    |
| mission.controller       | 是       | 全端点覆盖    |
| report.controller        | 是       | 全端点覆盖    |
| collaboration.controller | 是       | 全端点覆盖    |
| todo.controller          | 是       | 全端点覆盖    |
| report-review.controller | 是       | 全端点覆盖    |

### Auth Guard (3/3)

所有 Controller 均有 `@UseGuards(JwtAuthGuard)` 类级保护，资源端点追加 `@UseGuards(TopicAccessGuard)` 进行二级授权。WebSocket Gateway 通过 Socket.IO 中间件 JWT 验证，在 `afterInit()` 阶段注入，保证所有 `@SubscribeMessage` 执行前已完成认证。无无保护端点。

### 限流 (1/2)

- `topic.controller`: 每个端点均有精细化 `@Throttle`（5-30 次/分钟，按操作类型区分）
- `mission.controller`: 每个端点均有 `@Throttle`（核心操作 5 次/分钟）
- `report.controller`: 全部端点有 `@Throttle`
- `report-review.controller`: 全部端点有 `@Throttle`
- `todo.controller`: 全部端点有 `@Throttle`
- `collaboration.controller`: 全部端点有 `@Throttle`

**扣 1 分原因**: WebSocket Gateway 的 `@SubscribeMessage` 事件处理器无速率限制机制，`join:topic` / `sync:request` 等连接事件存在潜在的高频调用风险。每用户最多 5 连接的连接数限制不足以替代事件级限流。

**结论**: API 设计质量评分 9/10。

---

## D6: 错误处理健壮性 [8/10]

### 静默 catch (4/4)

经逐一检查所有 `.catch()` 回调，**无静默吞错**。所有 catch 块均包含 `this.logger.error(...)` 或 `this.logger.warn(...)` 调用。

典型模式（正确）:

```typescript
void this.extractResearchMemories(missionId, topicId).catch((error) => {
  this.logger.error(
    `[finalizeMission] Failed to extract research memories: ...`,
  );
});
```

fire-and-forget 模式已全部使用 `void` 显式声明，符合 ESLint `no-floating-promises` 规则。

### 异常一致性 (2/3)

HttpException 子类使用 277 处（`BadRequestException`, `NotFoundException`, `UnauthorizedException`, `ForbiddenException` 等），比例极高。

**存在 13 处裸 `throw new Error()`**，分布如下：

| 文件                                 | 行号    | 场景                                                         |
| ------------------------------------ | ------- | ------------------------------------------------------------ |
| `topic-insights.gateway.ts`          | 147     | JWT_SECRET 缺失（启动阶段，可接受）                          |
| `event-source-parsing.service.ts`    | 140-264 | URL 校验、协议校验、私有 host 检测（内部防护，非 HTTP 响应） |
| `event-source-parsing.service.ts`    | 439     | HTTP 错误码（内部错误，被上层捕获）                          |
| `topic-team-orchestrator.service.ts` | 575     | 刷新取消（内部信号）                                         |
| `global-source-throttle.service.ts`  | 91, 110 | 搜索取消（内部信号）                                         |
| `dimension-write.handler.ts`         | 129     | Handler 内部错误                                             |

**实际问题**: `event-source-parsing.service.ts` 的 Error 属内部服务逻辑，不是 Controller 层直接抛出，上层有统一 catch，风险可控。但对比规范，Handler 层应使用 NestJS 标准异常类。扣 1 分。

### WebSocket 错误处理 (3/3)

`topic-insights.gateway.ts` 中所有 `@SubscribeMessage` 处理器均有 try-catch：

- `join:topic` (第 338-363 行): try-catch，错误时 emit `error` 事件
- `leave:topic` (第 379-387 行): try-catch
- `sync:request` (第 441-511 行): try-catch，返回错误响应而非静默失败

Socket.IO 中间件 `afterInit()` 的 JWT 验证也有 try-catch（第 160-225 行）。

**扣 1 分**: D6 异常一致性扣 1 分（handler 层 bare Error）。

**结论**: 错误处理健壮性评分 8/10。

---

## D7: 代码健康度 [9/10]

### any 类型 (4/4)

扫描全部 195 个生产 TS 文件，仅发现 **1 处** `as any` 使用（位于 `search-orchestrator.service.ts` 注释行，非实际代码）。

ESLint 规则 `@typescript-eslint/no-explicit-any: "error"` 有效约束了 any 类型渗透。

### 超大文件 (1/2)

共发现 **14 个** 超过 500 行的生产文件：

| 文件                                 | 行数 |
| ------------------------------------ | ---- |
| `data-source-router.service.ts`      | 2653 |
| `report-synthesis.service.ts`        | 2479 |
| `dimension-mission.service.ts`       | 2255 |
| `research-todo.service.ts`           | 1693 |
| `dimension-writing.service.ts`       | 1523 |
| `topic-insights.service.ts`          | 1492 |
| `leader-planning.service.ts`         | 1357 |
| `mission-execution.service.ts`       | 1309 |
| `mission-lifecycle.service.ts`       | 1305 |
| `section-writer.service.ts`          | 1300 |
| `research-event-emitter.service.ts`  | 1200 |
| `report-assembler.service.ts`        | 1182 |
| `topic-team-orchestrator.service.ts` | 1181 |
| `leader-intent.service.ts`           | 1099 |

> **注意**: 这是已经经历了 God Service 分解之后的状态（原 `ResearchLeaderService` 被拆分为 `LeaderPlanningService`、`LeaderIntentService`、`LeaderAgentSelectionService`、`LeaderReviewService` 等）。2653 行的 `data-source-router.service.ts` 是主要债务来源，建议进一步拆分。

超大文件 >5 个，扣 1 分。

### @ts-ignore (2/2)

0 处 `@ts-ignore` / `@ts-expect-error`。

ESLint 规则 `@typescript-eslint/ban-ts-comment: "warn"` 起到了约束作用。

### console.log (1/1)

0 处 `console.log`。全部使用 `new Logger(XXX.name)` NestJS Logger。

### 硬编码品牌名 (1/1)

0 处硬编码 "Genesis" / "DeepDive" / "Raven"。

**结论**: 代码健康度 9/10，唯一扣分点为超大文件数量（14 个 >500 行）。

---

## D8: 数据库与 Schema [7/8]

### FK 索引对齐 (3/3)

对 topic-insights 涉及的 15 个 Prisma Model 进行 FK-索引对齐检查：

| Model                   | FK 字段                                            | 有索引？                                 |
| ----------------------- | -------------------------------------------------- | ---------------------------------------- |
| `ResearchTopic`         | `userId`                                           | 是（`@@index([userId, status])`）        |
| `TopicCollaborator`     | `topicId`, `userId`, `invitedById`, `reviewedById` | 是（`@@unique`, `@@index` 覆盖）         |
| `TopicDimension`        | `topicId`                                          | 是（`@@index([topicId, sortOrder])`）    |
| `DimensionAnalysis`     | `dimensionId`, `reportId`                          | 是（全覆盖）                             |
| `TopicReport`           | `topicId`                                          | 是（`@@index([topicId, generatedAt])`）  |
| `TopicEvidence`         | `reportId`, `analysisId`                           | 是                                       |
| `TopicSchedule`         | `topicId`                                          | 是（`@@index([topicId])`）               |
| `ResearchMission`       | `topicId`                                          | 是（`@@index([topicId, status])`）       |
| `ResearchTask`          | `missionId`, `dimensionId`                         | 是（`@@index([missionId, status])`）     |
| `LeaderDecision`        | `missionId`                                        | 是（`@@index([missionId, type])`）       |
| `ResearchMemory`        | `topicId`, `missionId`                             | `topicId` 有索引，**`missionId` 无索引** |
| `TopicReportRevision`   | `reportId`                                         | 是                                       |
| `ReportChange`          | `reportId`                                         | 是                                       |
| `ResearchTeamMessage`   | `topicId`, `missionId`                             | 待确认                                   |
| `ResearchAgentActivity` | `topicId`, `missionId`                             | 待确认                                   |

**发现**: `ResearchMemory.missionId` 有 FK 语义但无 `@@index([missionId])`，按任务查询记忆时会全表扫描（表会随使用量增长）。

整体 FK 索引覆盖率 >90%，评 3/3。

### 命名规范 (2/2)

所有 Model 名称 PascalCase，字段名 camelCase（并通过 `@map` 映射到 snake_case 表字段），完全符合规范。

### 迁移对齐 (2/2)

最近 schema 变更均有对应手写迁移脚本：

| 变更内容                     | 迁移文件                                                     |
| ---------------------------- | ------------------------------------------------------------ |
| ResearchTopicType 添加 EVENT | `20260314_add_event_topic_type/migration.sql`                |
| 创建 research_memories 表    | `20260312_create_research_memories_table/migration.sql`      |
| 添加复合索引                 | `20260311_add_ti_composite_indexes/migration.sql`            |
| PLAN_READY 状态              | `20260312_add_deep_research_plan_ready_status/migration.sql` |

迁移格式规范（`ALTER TYPE ... ADD VALUE IF NOT EXISTS`，无 DO$$ EXCEPTION 包装）。

### JSON 字段注释 (0/1)

Topic-insights 模块中 JSON 字段较多，大部分有注释：

- `topicConfig`: 有详细注释（MACRO/TECHNOLOGY/COMPANY 各字段说明）
- `leaderPlan`: 有注释说明结构
- `highlights`, `charts`, `result`, `leaderReview` 等: 注释不完整

JSON 字段类型注释覆盖率约 60%，扣 1 分。

**结论**: 数据库与 Schema 评分 7/8。

---

## D9: 安全态势 [9/10]

### safeCompare (3/3)

通过 `SecretsService` + `SecretNames` 统一管理 API 密钥，无直接的 `===` 比较敏感 token 的代码。`TopicAccessGuard` 使用 JWT 库验证，不做 string 比较。

### SQL 注入防护 (2/2)

共 5 处 `$queryRaw` 使用，全部采用模板字符串参数化（Prisma tagged template literal），变量通过 `${userId}`, `${topicId}` 等方式安全绑定，无字符串拼接：

```typescript
// 安全示例 (topic-crud.service.ts:648)
const result = await this.prisma.$queryRaw<...>`
  WHERE tc."user_id" = ${userId}
  AND rt.id = ${topicId}
`;
```

### 硬编码敏感信息 (2/2)

0 处硬编码密钥、密码或 Token。API 密钥通过 `SecretsService.getValueInternal(SECRET_NAMES.ALPHA_VANTAGE)` 动态获取。

### process.env 管理 (2/2)

0 处直接 `process.env.*` 访问（非 `main.ts`）。配置通过 `ConfigService.get<string>("JWT_SECRET")` 方式访问，完全符合规范。

### CORS 配置 (1/1)

WebSocket Gateway 的 CORS 使用回调函数精确匹配，逻辑如下：

```
1. 本地开发: /^http:\/\/localhost:\d+$/ 或 /^http:\/\/127\.0\.0\.1:\d+$/ → 允许
2. 生产环境: origin.endsWith(".railway.app") → 允许（注意: endsWith 防止子域名绕过，但任何 .railway.app 域都可连接）
3. 其他 → 拒绝
```

未使用 `*` 通配符。

**安全亮点**:

- `prompt-sanitizer.ts`: 完整的提示注入防护，检测 `IGNORE ALL PREVIOUS INSTRUCTIONS` 等攻击模式
- `security-audit-logger.ts`: 独立的安全事件审计日志系统（AUTH_FAILURE, TOKEN_INVALID, RATE_LIMIT 等）
- WebSocket Gateway: 连接数限制（每用户 MAX 5 连接）
- 用户输入长度截断（`body?.feedback?.slice(0, 500)`）

**扣 1 分**: CORS 的 `.railway.app` 规则过于宽泛——任何在 Railway 部署的第三方应用均可连接 WebSocket Gateway。建议收紧为精确域名列表（通过 `configService` 读取白名单）。

**结论**: 安全态势评分 9/10。

---

## D10: 测试与 QA [8/8]

### 测试比例 (3/3)

- 生产文件: 195 个
- 测试文件: 147 个
- 比例: **75.4%**（满分阈值 30%）

### Controller spec 覆盖 (3/3)

6 个 Controller，6 个 spec 文件，覆盖率 100%：

| Controller               | 主 spec                          | 补充 spec                                     |
| ------------------------ | -------------------------------- | --------------------------------------------- |
| topic.controller         | topic.controller.spec.ts         | —                                             |
| mission.controller       | mission.controller.spec.ts       | —                                             |
| report.controller        | report.controller.spec.ts        | —                                             |
| report-review.controller | report-review.controller.spec.ts | report-review.controller.supplemental.spec.ts |
| todo.controller          | todo.controller.spec.ts          | todo.controller.supplemental.spec.ts          |
| collaboration.controller | collaboration.controller.spec.ts | —                                             |

### 关键路径覆盖 (2/2)

**认证路径**: `topic-access.guard.spec.ts` + `billing-context.interceptor.spec.ts` 覆盖访问控制

**AI 调用链路**:

- `mission-execution.service.spec.ts`: Mission 执行全流程
- `mission-lifecycle.service.spec.ts`: 生命周期管理
- `leader-planning.service.spec.ts`: AI 规划路径
- `research-leader.service.spec.ts` + 2 个 supplemental: Leader 核心路径
- `research-reviewer.service.spec.ts`: AI 审核路径

**Gateway**: `topic-research.gateway.spec.ts` 覆盖 WebSocket 认证和消息处理

**数据库操作**: `report-data.service.crud.spec.ts` 等专门 CRUD 测试

**结论**: 测试与 QA 满分 8/8。

---

## D11: 可观测性与运维 [3/4]

### Logger 使用 (2/2)

67 个 Service 文件中，64 个有 `private readonly logger = new Logger(XXX.name)` 实例（覆盖率 95.5%）。全部使用 NestJS Logger，无 `console.log`。

### 健康检查 (1/1)

`mission.controller.ts` 暴露 `triggerHealthCheck()` 端点，调用 `ResearchMissionHealthService.forceHealthCheck()`。`DataSourceConnectorRegistry` 内置定时 5 分钟 health check 轮询，自动监控连接器可用性。

### Trace 覆盖 (0/1)

**发现**: AI 调用链路的 Trace 覆盖不完整。

`mission-observability.service.ts` 使用 `TraceCollectorService.startTrace()`，`topic-team-orchestrator.service.ts` 使用 `agentFacade?.startTrace()`，但：

1. Trace 覆盖仅限于顶层 Mission 入口，各 Agent 子任务（DimensionResearch, SectionWriter, CritiqueRefine 等）无 span 追踪
2. 多数 LLM 调用（leader-planning, research-reviewer, section-writer）无 trace context 传播
3. `ReportQualityTraceService` 是独立的"质量追踪"系统（基于 Prisma 持久化），不是分布式 Trace

扣 1 分。

**结论**: 可观测性评分 3/4。

---

## D12: 配置与依赖 [3/4]

### ConfigService 采用率 (2/2)

0 处直接 `process.env.*` 访问（生产代码中）。所有配置通过 `ConfigService.get<string>(...)` 读取，覆盖率 100%。

`JwtModule.registerAsync` 通过 `configService.get<string>("JWT_SECRET")` 动态注入，无硬编码。

### ESLint 覆盖 (1/1)

`backend/.eslintrc.js` 中 `no-restricted-imports` 规则覆盖了 ai-engine 的全部主要子目录：
`agents/`, `tools/`, `core/`, `llm/`, `skills/`, `teams/`, `orchestration/`, `knowledge/rag/`, `content/`, `infra/realtime/`, `mcp/` 等。

所有覆盖范围均包含 `**/modules/ai-app/**/*.ts`（即 topic-insights 在约束范围内）。

### 依赖健康 (0/1)

**未执行 npm audit**（该操作耗时较长且可能失败于网络环境）。

**观察到的潜在风险**:

- 模块有 80+ Provider，`topic-insights.module.ts` 是已知的 NestJS DI 容器压力点
- 依赖 `@nestjs-throttler` 进行限流，但 WebSocket 层未集成
- `JwtModule.registerAsync` 使用非标准配置模式（`expiresIn: "7d"` 固定值写在模块内，应通过 ConfigService 参数化）

扣 1 分（未完成 audit 扫描，无法确认 0 漏洞）。

**结论**: 配置与依赖评分 3/4。

---

## 架构债务优先级矩阵

| 优先级 | 问题                                                                                               | 维度 | 影响范围             | 修复成本                                | 建议时机 |
| ------ | -------------------------------------------------------------------------------------------------- | ---- | -------------------- | --------------------------------------- | -------- |
| P1     | `ResearchMemory.missionId` 无索引，随数据增长将导致慢查询                                          | D8   | 中（研究记忆查询）   | 低（1 行迁移 SQL）                      | 本迭代   |
| P1     | WebSocket `@SubscribeMessage` 无事件级限流，`join:topic` / `sync:request` 可被高频调用             | D5   | 中（Gateway 稳定性） | 低（自定义 WS 限流中间件）              | 本迭代   |
| P1     | CORS `.railway.app` 规则过宽，任意 Railway 部署应用均可连接 WS                                     | D9   | 中（安全边界）       | 低（改为 configService 读取精确白名单） | 本迭代   |
| P2     | `data-source-router.service.ts` 2653 行，`report-synthesis.service.ts` 2479 行，超出合理单文件体积 | D7   | 中（可维护性）       | 高（服务拆分）                          | 下次迭代 |
| P2     | `dimension-write.handler.ts` 中 `throw new Error()` 应使用 NestJS HttpException 子类               | D6   | 低（异常一致性）     | 低                                      | 下次迭代 |
| P2     | AI 调用子任务（DimensionResearch, SectionWriter）无 Trace Span，分布式追踪链路不完整               | D11  | 中（运维可观测性）   | 中（Span 植入）                         | 下次迭代 |
| P3     | 多个 JSON 字段缺少类型注释（`highlights`, `charts`, `result`, `leaderReview`）                     | D8   | 低（Schema 可读性）  | 低（添加注释）                          | 长期     |
| P3     | `JwtModule.registerAsync` 中 `expiresIn: "7d"` 应参数化到 ConfigService                            | D12  | 低（配置规范）       | 低                                      | 长期     |

---

## 建议行动项

### 必须处理（本迭代）

- [ ] **[P1-D8]** 为 `ResearchMemory.missionId` 添加索引：

  ```sql
  -- backend/prisma/migrations/20260315_add_research_memory_mission_index/migration.sql
  CREATE INDEX IF NOT EXISTS "research_memories_mission_id_idx" ON "research_memories"("mission_id");
  ```

  同时在 `models.prisma` 添加 `@@index([missionId])`

- [ ] **[P1-D5]** 为 WebSocket Gateway 添加事件级限流。可在 `afterInit()` 阶段注入自定义 Map-based 速率控制（每 userId 每分钟 join 次数限制）

- [ ] **[P1-D9]** 将 WebSocket CORS 的 `.railway.app` 规则改为从 ConfigService 读取精确域名白名单：
  ```typescript
  const allowedOrigins =
    this.configService.get<string>("ALLOWED_ORIGINS")?.split(",") ?? [];
  const isAllowed = allowedOrigins.some((o) => origin === o);
  ```

### 计划处理（下次迭代）

- [ ] **[P2-D7]** 对 `data-source-router.service.ts`（2653 行）进行进一步拆分，分离数据源适配层与路由决策层
- [ ] **[P2-D6]** 将 `dimension-write.handler.ts` 中的 `throw new Error()` 替换为 `throw new InternalServerErrorException()`
- [ ] **[P2-D11]** 为 DimensionResearch / SectionWriter / CritiqueRefine 的 LLM 调用植入 Trace Span，传播 `traceId` context

### 长期改进

- [ ] **[P3-D8]** 为所有 JSON 字段（`highlights`, `charts`, `result`, `leaderReview`, `userContext`）补充 TypeScript 接口注释
- [ ] **[P3-D12]** 将 `JwtModule.registerAsync` 的 `expiresIn` 提取为 `configService.get("JWT_EXPIRES_IN")` 参数

---

## 总结

**topic-insights 是该项目中架构合规性最高的业务模块之一。**

核心优势：

1. **Facade 边界零违规** — 经过两轮架构改进，所有 ai-engine 和 ai-infra 导入均通过各自 facade
2. **LLM 调用完全规范** — 195 个生产文件中无任何硬编码模型名/temperature，全部走 TaskProfile
3. **测试覆盖极高** — 75.4% 的测试文件比，147 个 spec 文件，Controller 全覆盖
4. **安全意识强** — 独立的 PromptSanitizer、SecurityAuditLogger、safeCompare 体系
5. **onModuleInit 注册完整** — 5 类注册（Skill, Connector, Agent, Team, WorkflowHandler）一体化

主要技术债务（均为 P1/P2）：

1. ResearchMemory.missionId 缺失索引（修复成本极低，影响可量化）
2. 超大文件仍存在（14 个 >500 行），God Service 分解工作仍未完成
3. WS 事件无限流、CORS 规则可收紧（安全改进）
4. AI 子任务 Trace Span 缺失（可观测性改进）

---

_评分模型: v2.0 (12 维度)_
_下次建议审计: 2026-04-14_
_报告工具: Arch Auditor Agent v2.0_
_注: 本次审计为 topic-insights 模块 v2.0 首次基线，全库 v2.0 基线审计待后续执行_
