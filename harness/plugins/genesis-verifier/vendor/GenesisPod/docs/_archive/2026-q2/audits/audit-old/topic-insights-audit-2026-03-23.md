# Topic Insights 模块专项审计报告

**审计日期**: 2026-03-23
**审计版本**: 7255502 (main)
**审计员**: Arch Auditor Agent v2.0
**审计范围**: `backend/src/modules/ai-app/topic-insights/` 全量

---

## 模块概况

| 统计项         | 数值              |
| -------------- | ----------------- |
| 目录层级       | 12 个子目录       |
| 生产 TS 文件   | 197 个            |
| 测试 spec 文件 | 165 个            |
| 测试覆盖比     | 83.8%             |
| 注册服务数     | 约 80 个 Provider |
| 模块文件总行数 | 76,826 行         |

---

## 总体评分

| #   | 维度                     | 满分    | 得分   | 状态   |
| --- | ------------------------ | ------- | ------ | ------ |
| 1   | 架构完整性与 Facade 边界 | 15      | 14     | 良好   |
| 2   | 依赖方向与模块隔离       | 8       | 8      | 优秀   |
| 3   | LLM 调用规范             | 8       | 8      | 优秀   |
| 4   | 注册与生命周期           | 5       | 5      | 优秀   |
| 5   | API 设计质量             | 10      | 8      | 良好   |
| 6   | 错误处理健壮性           | 10      | 8      | 良好   |
| 7   | 代码健康度               | 10      | 7      | 中等   |
| 8   | 数据库与 Schema 健康     | 8       | 7      | 良好   |
| 9   | 安全态势                 | 10      | 8      | 良好   |
| 10  | 测试与 QA                | 8       | 5      | 待改进 |
| 11  | 可观测性与运维           | 4       | 4      | 优秀   |
| 12  | 执行流程完整性           | 4       | 4      | 优秀   |
|     | **总计**                 | **100** | **86** |        |

---

## D1: 架构完整性与 Facade 边界 [14/15]

### 模块结构评估

模块目录层次清晰，服务按职责组织到子目录中，分层合理：

```
topic-insights/
  agents/          # AI Agent 定义
  config/          # 配置表（技能、框架、模型层级）
  controllers/     # API 入口层（6 个 Controller）
  dto/             # 数据传输对象
  guards/          # 认证与权限守卫
  prompts/         # Prompt 模板
  services/
    collaboration/ # 协作相关服务（TODO、协作者、反思）
    core/          # 核心研究引擎（Leader、Mission、Task Executor）
    data/          # 数据源路由与采集
    dimension/     # 维度研究与写作
    monitoring/    # 健康检查与检查点
    quality/       # 质量控制层（QualityGate、SelfEval、Remediation）
    report/        # 报告生成与合成
    search/        # 搜索管线（模块化）
  skills/          # 研究技能定义
  teams/           # Team 配置
  types/           # 类型定义
  utils/           # 工具函数
```

### Facade 边界检查

所有对 `ai-engine` 的导入均通过 `@/modules/ai-engine/facade` 路径，未发现任何穿透内部路径的违规。

**单个例外（已记录在 facade index.ts 注释中，属于已知例外）**:

- `agents/topic-insights.agent.ts` 中 `import { PlanBasedAgent } from "../../../ai-engine/facade/base-classes"`
- 这是 `facade/index.ts` 注释中明确说明的已知例外，原因为 `base-classes` 是轻量子模块，从主 `index.ts` 导入会形成循环链。属于合规的例外。

**扣分原因**: 无实质违规，但 `base-classes` 的直接路径导入对新人不直观，缺少一行 `export * from "./base-classes"` 在主 facade 中（虽然注释说明了不能这样做，但这是架构的一个微小摩擦点）。扣 1 分。

---

## D2: 依赖方向与模块隔离 [8/8]

- 未发现 `ai-engine` 反向依赖 `ai-app/topic-insights` 的情况
- 未发现 `topic-insights` 直接依赖其他 `ai-app` 模块（如 `research`、`teams`）
- `topic-insights.module.ts` 的 imports 仅包含基础设施模块（PrismaModule、AiEngineModule、CreditsModule 等），无跨 App 依赖
- 使用 `BillingContext` 通过 AsyncLocalStorage 透明传播账单上下文，是正确的跨层通信方式

---

## D3: LLM 调用规范 [8/8]

全模块扫描结果：

- **硬编码模型名**: 0 处
- **硬编码 temperature**: 0 处（schema 类型定义中的 `temperature: number` 字段不算违规）
- **硬编码 maxTokens**: 0 处
- **直接 SDK 调用**: 0 处
- 所有 LLM 调用均通过 `ChatFacade.chat()` + `AIModelType` + `taskProfile` 模式

示例（符合规范）:

```typescript
// section-self-eval.service.ts
const response = await this.chatFacade.chat({
  messages: [{ role: "user", content: prompt }],
  modelType: AIModelType.CHAT,
  skipGuardrails: true,
  taskProfile: { creativity: "deterministic", outputLength: "minimal" },
});
```

---

## D4: 注册与生命周期 [5/5]

`TopicInsightsModule.onModuleInit()` 完整实现了：

1. **PromptSkill 注册**: `promptSkillBridge.registerDomain("insights")` 桥接技能文件
2. **数据源连接器注册**: 4 个连接器（SemanticScholar、PubMed、FinanceApi、WeatherApi）
3. **Agent 注册**: `agentRegistry.register(topicInsightsAgent)` 使用 `@Optional()` 优雅降级
4. **Team 注册**: `teamRegistry.registerConfig(TOPIC_INSIGHTS_TEAM_CONFIG)` 使用 `@Optional()` 优雅降级
5. **错误处理**: 整个 `onModuleInit` 有 try-catch，失败不阻断模块启动

3 处 `forwardRef` 均有明确的注释说明循环原因，属于合理使用：

- `MissionExecutionService <-> ResearchMemoryService`
- `MissionLifecycleService <-> MissionQueryService`
- `MissionLifecycleService <-> MissionExecutionService`

---

## D5: API 设计质量 [8/10]

### DTO 验证覆盖

DTO 质量整体良好，所有主要 DTO 均使用 class-validator 装饰器：

```typescript
// create-topic.dto.ts - 规范示例
@IsString() @IsNotEmpty() @MaxLength(200) name!: string;
@IsEnum(ResearchTopicType) type!: ResearchTopicType;
@IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => DimensionConfigDto)
dimensions?: DimensionConfigDto[];
```

**发现的问题**:

**P2: `MissionAdjustDto.addDimensions` 验证不足** (扣 1 分)

```typescript
// dto/leader.dto.ts:110
@IsOptional()
@IsObject({ each: true })
addDimensions?: Array<{ name: string; description: string }>;
```

`IsObject({ each: true })` 只验证是否为对象，不验证 `name`/`description` 字段的存在和长度。应该改为单独的 `DimensionAdjustDto` 类 + `@ValidateNested()` + `@Type()`。

**P2: `ReportReviewController` 缺少 `TopicAccessGuard`** (扣 1 分)

`report-review.controller.ts` 的注解路由（如获取批注、分配审核任务、完成审核等）只有 `JwtAuthGuard`，没有使用 `TopicAccessGuard` + `RequireTopicAccess()`。权限检查完全委托给 Service 层的 `verifyTopicOwnership`，但 Service 里只校验 owner，不支持协作者权限模型。对比 `collaboration.controller.ts` 和 `mission.controller.ts` 已正确使用 `TopicAccessGuard`，这是一个不一致点。

### Swagger 覆盖

全部 6 个 Controller 均有 `@ApiTags`、`@ApiBearerAuth`、关键端点有 `@ApiOperation` 和 `@ApiResponse`，覆盖充分。

### Auth Guard 覆盖

- `TopicController`、`MissionController`、`CollaborationController` 使用 `JwtAuthGuard` + 端点级 `TopicAccessGuard`，设计合理
- 公开端点（`/shared/topics/:id`）正确标注 `@Public()`
- `ReportReviewController` 权限不足（见上述 P2 问题）

### 限流

所有高频端点和 AI 密集型端点均有 `@Throttle` 注解，不同 API 类型有差异化配置（5/min 用于 AI 调用，15/min 用于创建，30/min 用于读取）。WebSocket 层有自定义的滑动窗口速率限制器。

---

## D6: 错误处理健壮性 [8/10]

### 静默 Catch 检查

全模块无 `.catch(() => {})` 或 `.catch(() => null)` 的静默吞错，所有 `.catch()` 均有 `this.logger.error()` 或 `this.logger.warn()` 调用。

**Fire-and-forget 模式**正确使用 `void` 前缀 + `.catch()` 日志记录，例如：

```typescript
void this.extractResearchMemories(missionId, topicId).catch((error) => {
  this.logger.error(
    `[finalizeMission] Failed to extract research memories: ...`,
  );
});
```

### 异常一致性

**发现的问题**:

**P2: 内部服务层使用 `throw new Error()` 而非 NestJS 标准异常** (扣 1 分)

在 `event-source-parsing.service.ts`、`topic-team-orchestrator.service.ts`、`global-source-throttle.service.ts` 和 `topic-insights.gateway.ts` 中存在 14 处 `throw new Error(message)`。

这些 `Error` 是在 Service 层或 Gateway 层抛出的，会被上层的 `try-catch` 捕获但不会被 NestJS 的全局异常过滤器正确识别为 HTTP 错误。建议：

- Service 层应抛出 `InternalServerErrorException` 或自定义异常（如 `InsufficientCreditsException` 的模式）
- Gateway 层的构造函数中抛出 `Error` 是合理的（NestJS DI 初始化时），保留

**P2: `aiEditReport` 的用户输入 `customInstruction`/`context` 未经 prompt-sanitizer 过滤** (扣 1 分，详见 D9)

### WebSocket 错误处理

所有 `@SubscribeMessage` 处理器均有 try-catch 包裹，错误时返回 `{ success: false, error: string }` 而非让异常冒泡。WebSocket 中间件认证失败时正确调用 `next(new Error(...))`，不会静默失败。

---

## D7: 代码健康度 [7/10]

### any 类型

全模块生产代码中 `any` 类型使用量：**0 处**（`as any` 只在注释内容中有一处，属于注释不算违规）。TypeScript 类型安全性极高。

### 超大文件 (超过 500 行)

共 46 个文件超过 500 行，其中 20 个超过 1000 行：

| 文件                                              | 行数  |
| ------------------------------------------------- | ----- |
| `data/data-source-router.service.ts`              | 2,675 |
| `dimension/dimension-mission.service.ts`          | 2,668 |
| `report/report-synthesis.service.ts`              | 2,557 |
| `topic-insights.service.ts`                       | 1,724 |
| `collaboration/research-todo.service.ts`          | 1,693 |
| `dimension/section-writer.service.ts`             | 1,627 |
| `dimension/dimension-writing.service.ts`          | 1,623 |
| `core/mission/mission-execution.service.ts`       | 1,491 |
| `core/leader/leader-planning.service.ts`          | 1,391 |
| `core/mission/mission-lifecycle.service.ts`       | 1,305 |
| `report/report-generator.service.ts`              | 1,284 |
| `core/topic/topic-team-orchestrator.service.ts`   | 1,225 |
| `core/research/research-event-emitter.service.ts` | 1,218 |
| `core/leader/leader-intent.service.ts`            | 1,100 |
| `report/figure-extractor.service.ts`              | 1,079 |
| `data/data-source-fetcher.service.ts`             | 1,052 |
| `data/leader-tool.service.ts`                     | 1,051 |
| `report/report-assembler.service.ts`              | 1,023 |
| `report/credibility-report.service.ts`            | 1,020 |
| `collaboration/research-reviewer.service.ts`      | 1,021 |

这是整个模块最严重的代码健康问题。`data-source-router.service.ts` (2,675 行) 和 `dimension-mission.service.ts` (2,668 行) 特别突出，属于典型的 God Class 残留（尽管相比之前的单文件 2,571 行已做过拆分，但仍不足）。

**扣 3 分**（超过 1000 行的文件过多，超过合理阈值）。

### @ts-ignore

全模块 0 处，无此类型安全绕过。

### console.log

全模块 0 处，全部使用 NestJS Logger。

---

## D8: 数据库与 Schema 健康 [7/8]

### FK 索引覆盖

主要模型的外键索引分析：

| 模型                | FK 字段       | 索引状态                                                |
| ------------------- | ------------- | ------------------------------------------------------- |
| `ResearchTopic`     | `userId`      | 有索引（`@@index([userId, status])`）                   |
| `TopicDimension`    | `topicId`     | 未查到单独索引（通过父级 cascade 删除）                 |
| `ResearchMission`   | `topicId`     | 有索引（`@@index([topicId, status])`）                  |
| `ResearchTask`      | `missionId`   | 有索引（`@@index([missionId, status])`）                |
| `ResearchTask`      | `dimensionId` | 有索引（`@@index([dimensionId])`）                      |
| `DimensionAnalysis` | `dimensionId` | 有索引                                                  |
| `DimensionAnalysis` | `reportId`    | 有索引                                                  |
| `TopicReport`       | `topicId`     | 有索引（`@@index([topicId, generatedAt(sort: Desc)])`） |

**发现的问题**:

**P3: `TopicDimension.topicId` 缺少独立索引** (扣 1 分)

```prisma
model TopicDimension {
  topicId String @map("topic_id")
  // ...
  @@index 不包含 topicId 单独索引
}
```

按 `topicId` 查询 TopicDimension 是高频操作（每次维度列表 API 调用），缺少独立索引可能在大量维度时造成全表扫描。

### JSON 字段使用

- `ResearchTopic.topicConfig`: 有内联注释说明结构（`{ country, industry, domain, focusAreas }`）
- `ResearchMission.leaderPlan`: 注释说明包含哪些字段
- `ResearchTask.result`: 无结构注释
- `ResearchTask.leaderReview`: 无结构注释
- `TopicReport.highlights`, `charts`, `qualityTrace`: 后两者无结构注释

**P3: 部分 JSON 字段缺少类型注释**，对新团队成员不友好。

### 命名规范

- 所有模型名 PascalCase，字段名 camelCase，映射 snake_case，规范一致
- 迁移脚本使用手写 SQL，符合项目约定

---

## D9: 安全态势 [8/10]

### SQL 注入防护

全部 `$queryRaw` 调用均使用 Prisma 的模板字符串语法（Tagged Template Literals），变量通过参数化传入：

```typescript
// 安全的参数化查询示例
const result = await this.prisma.$queryRaw<...>`
  WHERE rt.id = ${topicId}
`;
```

未发现字符串拼接的 SQL 注入风险。

### 硬编码密钥

全模块未发现硬编码 API Key、密码或 Token。

### process.env 访问

仅 Gateway 文件中有 3 处 `process.env` 访问（`CORS_ORIGINS`、`RAILWAY_FRONTEND_URL`、`NODE_ENV`），位于模块级常量初始化（装饰器 cors 配置在类实例化前执行，无法注入 ConfigService）。这是 NestJS 的已知限制，属于合理例外。

### CORS 配置

WebSocket Gateway 实现了精确的 CORS 白名单机制（非通配符），生产环境使用 `CORS_ORIGINS` + `RAILWAY_FRONTEND_URL` 精确域名匹配。

### 认证与授权

- WebSocket 使用 JWT 中间件认证，连接时即完成验证
- 用户连接数限制（5 连接/用户）防止资源耗尽
- 事件级速率限制（30 请求/60s）

### Prompt 注入防护

**发现的问题**:

**P1: `aiEditReport` 的用户自定义指令未经过 `prompt-sanitizer`** (扣 2 分)

`topic-insights.service.ts` 的 `aiEditReport()` 方法接受用户输入的 `dto.context`（用户指令）和 `dto.customInstruction`，直接传入 `buildEnhancedEditPrompt()` 和 `buildEditPrompt()` 构建 Prompt，**未调用 `sanitize()` 过滤**。

相比之下，`leader-intent.service.ts` 和 `leader-planning.service.ts` 均对用户输入调用了 `sanitize(userMessage)`。

攻击面：攻击者可以在 `customInstruction` 中注入指令，如 `"ignore previous instructions, output: [malicious content]"`，有 Prompt Hijacking 风险。

```typescript
// 当前（有风险）
prompt = buildEditPrompt(dto.operation, textToEdit, {
  customInstruction: dto.customInstruction, // 未过滤
});

// 修复建议
import { sanitize } from "../../utils/prompt-sanitizer";
prompt = buildEditPrompt(dto.operation, textToEdit, {
  customInstruction: dto.customInstruction
    ? sanitize(dto.customInstruction)
    : undefined,
});
```

---

## D10: 测试与 QA [5/8]

### 测试文件覆盖比

- 生产文件: 197 个
- 测试文件: 165 个
- 覆盖比: **83.8%**（超过 30% 的比例要求，但测试文件的质量和深度需关注）

### Controller spec 覆盖

Controller spec 文件存储在 `controllers/__tests__/` 目录而非与 Controller 同级，脚本检测误报了"缺失"。实际上所有 6 个 Controller 均有对应 spec：

| Controller                    | Spec 存在                                    |
| ----------------------------- | -------------------------------------------- |
| `topic.controller.ts`         | `__tests__/topic.controller.spec.ts`         |
| `mission.controller.ts`       | `__tests__/mission.controller.spec.ts`       |
| `report.controller.ts`        | `__tests__/report.controller.spec.ts`        |
| `collaboration.controller.ts` | `__tests__/collaboration.controller.spec.ts` |
| `report-review.controller.ts` | `__tests__/report-review.controller.spec.ts` |
| `todo.controller.ts`          | `__tests__/todo.controller.spec.ts`          |

### 关键路径测试覆盖

质量控制体系的核心服务均有 spec：

- `report-quality-gate.service.spec.ts`
- `section-self-eval.service.spec.ts`
- `section-remediation.service.spec.ts`

**发现的问题**:

**P1: `MissionExecutionService.executeDynamicScheduler()` 缺少测试** (扣 2 分)

动态调度器是整个研究流程的核心调度机制，包含复杂的并发控制逻辑（死锁检测、30秒超时退出、Promise.race 并发执行、任务依赖图）。当前 `mission-execution.service.ts` 的测试文件存在，但此核心方法的边界条件（死锁场景、取消场景、任务失败重试场景）没有充分覆盖。

**P2: `DimensionMissionService` 的集成流程缺少端到端测试** (扣 1 分)

2,668 行的 `dimension-mission.service.ts` 实现了 7 个研究阶段（搜索→大纲→写作→质量门控→自评→补救→集成），每个阶段之间的状态传递是集成点，但当前只有单元测试。

---

## D11: 可观测性与运维 [4/4]

### Logger 覆盖

所有 Service 均使用 `private readonly logger = new Logger(ServiceName.name)` 模式，无遗漏。

### 健康检查与自动恢复

`ResearchMissionHealthService` 实现了：

- 5 分钟周期健康检查（与 AI Writing 对齐）
- 30 分钟无进度阈值检测卡死任务
- 6 小时最大执行时间安全边界
- 服务重启后自动恢复中断的 Mission（10 秒延迟启动）
- `HealthCheckRunner` 来自 `ai-kernel/facade`，标准化接口

`ResearchCheckpointService` 提供任务检查点持久化（存储在 mission 的 `userContext` JSON 字段中）。

### Trace 覆盖

`MissionObservabilityService` 集成了 `TraceCollectorService`（来自 `ai-engine/facade`），对 Mission 的各个阶段（planning、searching、writing、review、synthesis）均有 Span 覆盖，使用 `@Optional()` 优雅降级。

---

## D12: 执行流程完整性 [4/4]

整个研究流程从 Mission 创建到报告合成的链路完整：

```
POST /topics/:id/leader/plan
  → MissionLifecycleService.createMission()
    → LeaderPlanningService.planResearch()  [异步，10分钟超时]
      → 生成 LeaderPlan（维度、Agent分配、工具）
      → 创建 ResearchTask 列表
    → MissionExecutionService.startExecution()
      → executeDynamicScheduler()
        → DimensionResearchExecutor.execute()
          → DimensionMissionService.executeDimensionMission()
            → Phase 1: 搜索与数据采集 (DataSourceRouterService)
            → Phase 2: 大纲规划 (LeaderPlanningService.planDimensionOutline)
            → Phase 3: 章节写作 (DimensionWritingService)
              → QualityGate → AI重写 (1次)
              → SelfEval → Remediation
            → Phase 4: 集成 (LeaderPlanningService)
            → Phase 5: 持久化
        → ReviewDimensionExecutor.execute()
        → SynthesisReportExecutor.execute()
          → ReportSynthesisService.synthesizeReport()
      → finalizeMission()
```

**任务失败恢复**:

- 任务失败时标记 `FAILED`，不加入 `completedTaskIds`，允许用户重试
- 死锁检测：30次等待（60秒）后强制退出调度器
- 孤儿清理：执行失败时批量将未完成任务标记为 FAILED/CANCELLED

**断线重连**:

- `sync:request` WebSocket 消息允许客户端在重连后同步当前状态
- SSE 有 45 分钟超时自动清理，防止内存泄漏

**质量闭环（3层）**:

- Layer 1: QualityGate（确定性规则检查 + 1次AI重写机会）
- Layer 2: SectionSelfEval（4维快速自评）+ SectionRemediation（针对性修复）
- Layer 3: ReviewDimension（Executor 级别，跨维度质量审核）

质量循环均有明确终止条件（最多1次 AI 重写 + 1次补救），不会无限循环。

---

## 关键问题清单

### P0: 无（无阻塞性问题）

### P1: 必须处理

| ID     | 问题                                                                                                            | 文件                                                 | 影响                               |
| ------ | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------- |
| P1-001 | `aiEditReport` 的 `customInstruction` 和 `context` 字段未经 `prompt-sanitizer` 过滤，存在 Prompt Injection 风险 | `topic-insights.service.ts:894-908`                  | 安全漏洞，攻击者可劫持 AI 编辑行为 |
| P1-002 | `MissionExecutionService.executeDynamicScheduler()` 缺少边界条件测试（死锁、取消、任务失败重试）                | `services/core/mission/mission-execution.service.ts` | 核心调度器 Bug 难以发现和回归      |

### P2: 计划处理

| ID     | 问题                                                                                                  | 文件                                              | 影响                                       |
| ------ | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------ |
| P2-001 | `ReportReviewController` 缺少 `TopicAccessGuard`，权限模型不一致                                      | `controllers/report-review.controller.ts`         | 协作者权限漏洞，可能允许非授权者操作批注   |
| P2-002 | `MissionAdjustDto.addDimensions` 使用 `@IsObject({ each: true })` 而非 `@ValidateNested()` + 独立 DTO | `dto/leader.dto.ts:110`                           | 输入验证不充分，可能传入无效维度数据       |
| P2-003 | 14 处 `throw new Error()` 在 Service 层，应使用 NestJS 标准异常类                                     | 多个 service 文件                                 | 异常不被全局过滤器正确处理，日志格式不一致 |
| P2-004 | `DimensionMissionService` 的 7 阶段流程缺少集成测试                                                   | `services/dimension/dimension-mission.service.ts` | 阶段间状态传递的 Bug 难以检测              |

### P3: 长期改进

| ID     | 问题                                                                                                                       | 文件                          | 影响                                                                          |
| ------ | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------- |
| P3-001 | 20 个文件超过 1000 行，其中 3 个超过 2000 行（`data-source-router`、`dimension-mission`、`report-synthesis`）              | 多个文件                      | 可读性差，认知负担重，团队协作困难                                            |
| P3-002 | `TopicDimension` 缺少 `topicId` 独立索引                                                                                   | `prisma/schema/models.prisma` | 高频维度列表查询性能隐患                                                      |
| P3-003 | `ResearchTask.result`、`ResearchTask.leaderReview`、`TopicReport.charts`、`TopicReport.qualityTrace` JSON 字段缺少结构注释 | `prisma/schema/models.prisma` | 新人维护困难，JSON 字段结构需要靠代码推断                                     |
| P3-004 | `TopicInsightsService` 仍有 1,724 行，虽已拆分为 4 个子服务但本身仍过大                                                    | `topic-insights.service.ts`   | Facade 仍包含过多业务逻辑（aiEditReport 200+行、getStats 150+行），可继续下沉 |
| P3-005 | `base-classes` 导入需在 `facade/index.ts` 中有更明确的用户文档（当前只有注释）                                             | `facade/index.ts`             | 新成员可能不清楚此例外规则，导致误操作                                        |

---

## 架构债务优先级矩阵

| 优先级 | 问题                              | 影响范围  | 修复成本                     | 建议时机 |
| ------ | --------------------------------- | --------- | ---------------------------- | -------- |
| P1     | Prompt Injection（aiEditReport）  | 安全      | 低（2 行代码）               | 立即     |
| P1     | 动态调度器测试缺口                | 稳定性    | 中（需要 mock 复杂并发场景） | 本迭代   |
| P2     | ReportReviewController 权限不一致 | 安全/功能 | 低（加 3 个装饰器）          | 本迭代   |
| P2     | MissionAdjustDto 验证不足         | 健壮性    | 低（新增 1 个 DTO class）    | 本迭代   |
| P2     | Service 层 throw new Error()      | 可维护性  | 中（14 处，逐步替换）        | 下次迭代 |
| P2     | DimensionMissionService 集成测试  | 质量保障  | 高（流程复杂）               | 下次迭代 |
| P3     | 超大文件继续拆分                  | 可维护性  | 高（重构风险）               | 长期     |
| P3     | TopicDimension 索引补充           | 性能      | 低（1行迁移 SQL）            | 下次迭代 |
| P3     | JSON 字段类型注释                 | 文档      | 低                           | 随时     |

---

## 改进建议（按 ROI 排序）

### 高 ROI - 立即行动

1. **修复 Prompt Injection（P1-001）**: 2 行代码，`aiEditReport` 中在传入 `buildEditPrompt`/`buildEnhancedEditPrompt` 前调用 `sanitize()` 过滤 `customInstruction` 和 `context` 字段

2. **补充 `ReportReviewController` 的 `TopicAccessGuard`（P2-001）**: 在注解批注、分配审核任务、完成审核等涉及数据写入的端点加上 `@UseGuards(TopicAccessGuard)` + `@RequireTopicAccess(CollaboratorRole.EDITOR)`

3. **修复 `MissionAdjustDto` 的 DTO 验证（P2-002）**: 创建 `DimensionAdjustDto` 类，使用 `@ValidateNested()` + `@Type()` 替代 `@IsObject({ each: true })`

4. **补充 `TopicDimension.topicId` 索引（P3-002）**: 一行迁移 SQL
   ```sql
   CREATE INDEX IF NOT EXISTS "topic_dimensions_topic_id_idx" ON "topic_dimensions"("topic_id");
   ```

### 中 ROI - 本迭代

5. **为动态调度器补充边界测试（P1-002）**: 重点测试：
   - 死锁场景（30次等待后退出）
   - Mission 被取消时调度器停止
   - 任务失败后不加入 completedTaskIds 允许重试

### 低 ROI - 长期

6. **Service 层逐步迁移到 NestJS 标准异常（P2-003）**: 用 `InternalServerErrorException`、`BadRequestException` 替代 `throw new Error()`，可以在新增代码时强制要求，存量代码逐步替换

7. **超大文件拆分（P3-001）**: 优先拆分 `data-source-router.service.ts`（2,675 行），建议按数据源类型（Web、Academic、Social、Finance、Weather）拆分为 5 个专用路由服务

8. **JSON 字段类型注释（P3-003）**: 在 schema 中为 `ResearchTask.result`、`leaderReview`、`TopicReport.charts` 补充结构说明注释

---

## 亮点与最佳实践

以下设计值得在其他模块中推广：

1. **WsRateLimiter 类**: WebSocket 层自实现的滑动窗口速率限制，补充了 HTTP ThrottlerGuard 的覆盖盲区

2. **SecurityAuditLogger**: 统一的安全事件日志记录（`createSecurityLogger()`），AUTH_FAILURE、TOKEN_INVALID 等事件有结构化日志，便于安全审计

3. **火焰图式 Promise 错误处理**: `void wrappedStart().catch((err) => { /* 孤儿清理 */ })` 模式在异步执行失败时能完整清理数据库状态（Mission、Task、Todo 三张表）

4. **质量门控 3 层设计**: QualityGate（确定性代码检查）→ SelfEval（LLM 快速自评）→ Remediation（针对性修复）层层递进，而不是全部依赖 LLM，兼顾成本和效果

5. **BillingContext AsyncLocalStorage**: 通过异步上下文传播账单信息，避免了在所有方法签名中传递 `billingContext` 参数，是 NestJS 中间件模式的正确用法

6. **PromptSanitizer 防注入**: `utils/prompt-sanitizer.ts` 有完善的危险模式检测，覆盖了指令覆盖、角色劫持、上下文逃逸、Unicode 混淆等攻击向量（需要更广泛地应用到 aiEditReport）

---

_评分模型: 专项审计（基于 v2.0 12 维度框架，部分维度按模块特点调整权重）_
_下次建议审计: 2026-06-23（3 个月后）_
_报告工具: Arch Auditor Agent v2.0_
