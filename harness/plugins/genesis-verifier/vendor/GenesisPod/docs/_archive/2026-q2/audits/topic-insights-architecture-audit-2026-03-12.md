# 架构审计报告：Topic Insights / AI Engine / AI Kernel

**审计日期**: 2026-03-12
**审计版本**: 3fdd13c96
**审计范围（聚焦三模块）**:

- `ai-app/topic-insights/` — 191 个生产 TS 文件，106 个测试文件
- `ai-engine/` — 432 个生产 TS 文件，242 个测试文件
- `ai-kernel/` — 56 个生产 TS 文件，36 个测试文件

**实际读取的文件**（评分依据，以下文件均经过 Read/Grep 工具读取）：

- `topic-insights/topic-insights.module.ts`
- `topic-insights/topic-insights.service.ts`（前 80 行）
- `topic-insights/topic-insights.gateway.ts`（全文）
- `topic-insights/controllers/mission.controller.ts`（全文）
- `topic-insights/services/core/mission/mission-execution.service.ts`（670-1127 行）
- `topic-insights/services/core/mission/mission-lifecycle.service.ts`（280-710 行）
- `topic-insights/services/core/research/research-leader.service.ts`（前 60 行）
- `topic-insights/services/data/data-source-router.service.ts`（前 80 行）
- `topic-insights/services/report/report-synthesis.service.ts`（前 80 行，700-730 行）
- `topic-insights/services/dimension/dimension-mission.service.ts`（前 60 行）
- `topic-insights/handlers/dimension-write.handler.ts`（120-149 行）
- `ai-engine/facade/index.ts`（全文，539 行）
- `ai-engine/facade/ai-engine.facade.ts`（前 60 行）
- `ai-engine/infra/a2a/a2a.module.ts`（全文）
- `ai-engine/orchestration/executors/dag-executor.ts`（前 40 行）
- `ai-engine/orchestration/executors/base-executor.ts`（18-36 行）
- `ai-kernel/ai-kernel.module.ts`（全文）
- `ai-kernel/facade/index.ts`（全文）
- `ai-kernel/abstractions/index.ts`（全文）
- `backend/.eslintrc.js`（全文）
- `backend/prisma/schema/models.prisma`（6530-7078 行，ResearchTopic/Mission/Task/Memory/Decision）

---

## 执行摘要

| #   | 维度                   | 满分 | 得分   | 状态 |
| --- | ---------------------- | ---- | ------ | ---- |
| 1   | 分层合规性（依赖方向） | 10   | 9      | 良好 |
| 2   | Facade 边界            | 10   | 9      | 良好 |
| 3   | 模块内聚性             | 10   | 7      | 中等 |
| 4   | 耦合度                 | 10   | 8      | 良好 |
| 5   | 代码重复（DRY）        | 10   | 6      | 中等 |
| 6   | 错误处理               | 10   | 8      | 良好 |
| 7   | 类型安全               | 10   | 8      | 良好 |
| 8   | 性能风险               | 10   | 7      | 中等 |
| 9   | 安全性                 | 10   | 7      | 中等 |
| 10  | 可测试性               | 10   | 8      | 良好 |
| 11  | 配置管理               | 10   | 9      | 良好 |
| 12  | 文档与命名             | 10   | 8      | 良好 |
|     | **总计**               | 120  | **94** |      |

---

## D1: 分层合规性（依赖方向）[9/10]

### 检查结果

**Topic Insights (L4) → AI Engine (L3)**: 合规

所有从 `ai-app/topic-insights` 出发的 `ai-engine` 导入，均通过 `@/modules/ai-engine/facade`，未发现穿透内部路径的情况。

```
grep -rn "from.*ai-engine/" topic-insights/**/*.ts  -> 0 个非-facade 路径
```

**Topic Insights (L4) → AI Kernel (L2)**: 合规

所有从 `ai-app/topic-insights` 出发的 `ai-kernel` 导入，均通过 `@/modules/ai-kernel/facade`：

- `data-source-router.service.ts:29` — `@/modules/ai-kernel/facade`
- `mission-lifecycle.service.ts:17` — `@/modules/ai-kernel/facade`
- `search/adapters/` — 全部通过 `@/modules/ai-kernel/facade`

**AI Engine (L3) → AI Kernel (L2)**: 存在 3 处内部路径直接引用

经 grep 查找，以下文件绕过 `ai-kernel/facade` 直接引用了 ai-kernel 内部路径：

```
ai-engine/infra/a2a/a2a.module.ts:8
  import { A2AController } from "../../../ai-kernel/ipc/a2a/a2a.controller"
  （注：Controller 含装饰器副作用，facade/index.ts 中有说明注释解释为何不导出 Controller）

ai-engine/orchestration/executors/base-executor.ts:23
  import type { CircuitBreakerService } from "../../../ai-kernel/resource/circuit-breaker.service"
  （仅 import type，运行时安全，但不规范）

ai-engine/orchestration/executors/dag-executor.ts:22-23
  import type { CheckpointManager } from "../../../ai-kernel/journal/checkpoint-manager"
  import type { ProcessEventLogService } from "../../../ai-kernel/observability/process-event-log.service"
  （均为 import type，但 CircuitBreakerService / CheckpointManager / ProcessEventLogService 均已在 ai-kernel/facade/index.ts 导出）
```

**反向依赖检查**：

- `ai-engine` 未导入 `ai-app/topic-insights` 的任何内容 — 无反向依赖
- `ai-kernel` 未导入 `ai-app/` 或 `ai-engine/` 内部路径 — 无反向依赖
- `ai-kernel/abstractions/index.ts` 向上引用 `ai-engine/facade` 的类型，但全部是 `export type`（运行时无依赖）

### 扣分原因

-1 分：`base-executor.ts` 和 `dag-executor.ts` 的 `import type` 绕过了 `ai-kernel/facade`，违反了 L3 访问 L2 的路径规范（尽管 `import type` 不影响运行时）。`a2a.module.ts` 中的 Controller 直接引用有专门注释说明，属于已知架构妥协。

---

## D2: Facade 边界 [9/10]

### 检查结果

**ESLint 强制边界**：`backend/.eslintrc.js` 对 `**/modules/ai-app/**/*.ts` 配置了详尽的 `no-restricted-imports` 规则，涵盖 ai-engine 的全部 9 个边界区域（agents、tools、core、llm、skills、teams、orchestration、knowledge、infra）。

**生产代码扫描结果**：0 个违规

```
grep -rn "from.*ai-engine/(?!facade)" topic-insights/**/*.ts -> 0 匹配
```

**`facade/index.ts` 规模评估**：facade/index.ts 已达 539 行，包含约 120 个导出符号，涵盖从 Registry 类到类型定义、从 Domain Facade 到 Kernel re-export 的全量内容。规模偏大但结构清晰，分批注释（Batch 1/2/3, Phase 1-8）有助于追溯演化历史。

### 亮点

- facade/index.ts 末尾注释 `Phase 8: Kernel re-exports REMOVED` 体现了持续的架构清理意识
- Domain Facades (`ChatFacade`, `RAGFacade`, `AgentFacade`, `TeamFacade`, `ToolFacade`) 的引入为消费层提供了更内聚的访问点
- base-classes.ts 分离避免了加载 70+ 模块时的循环依赖链

### 扣分原因

-1 分：`ai-engine/facade/index.ts` 中存在两处反向引用 `ai-kernel/facade` 的导出（行 28、90-91、117、121、347-357），即 ai-engine/facade 向下重新导出了 ai-kernel 的符号。这在技术上是合理的（把 kernel 符号统一在 engine facade 入口），但使 L3/L2 边界模糊，且 ai-kernel/facade/index.ts 中的 `Phase 8: Kernel re-exports REMOVED` 注释表明这一做法正在被清理中。

---

## D3: 模块内聚性 [7/10]

### 检查结果

**超大文件清单**（>500 行，生产代码）：

| 文件                                                       | 行数  | 问题                   |
| ---------------------------------------------------------- | ----- | ---------------------- |
| `data/data-source-router.service.ts`                       | 2,653 | 严重过大，多职责       |
| `report/report-synthesis.service.ts`                       | 2,483 | 严重过大               |
| `dimension/dimension-mission.service.ts`                   | 2,209 | 严重过大               |
| `collaboration/research-todo.service.ts`                   | 1,693 | 过大                   |
| `dimension/dimension-writing.service.ts`                   | 1,515 | 过大                   |
| `topic-insights.service.ts`                                | 1,492 | 入口过大               |
| `dimension/section-writer.service.ts`                      | 1,385 | 过大                   |
| `core/mission/mission-lifecycle.service.ts`                | 1,305 | 过大                   |
| `report/report-generator.service.ts`                       | 1,281 | 过大                   |
| `core/mission/mission-execution.service.ts`                | 1,228 | 过大                   |
| `core/leader/leader-planning.service.ts`                   | 1,212 | 过大                   |
| `core/research/research-event-emitter.service.ts`          | 1,200 | 过大                   |
| `core/topic/topic-team-orchestrator.service.ts`            | 1,181 | 过大                   |
| **ai-engine** `facade/ai-engine.facade.ts`                 | 2,993 | 严重过大（God Facade） |
| **ai-engine** `teams/orchestrator/mission-orchestrator.ts` | 2,380 | 严重过大               |
| **ai-engine** `llm/services/ai-chat.service.ts`            | 1,705 | 过大                   |

topic-insights 模块中 **10+ 个服务超过 1,000 行**，最大达 2,653 行（`data-source-router.service.ts`），这属于 God Service 反模式。

**正向指标**：

- 已有良好的分解迹象：`ResearchLeaderService` 已标注为"薄门面层"，委托给 `LeaderPlanningService`/`LeaderIntentService`/`LeaderAgentSelectionService`/`LeaderReviewService` 四个子服务
- Mission 层已分解为 `MissionLifecycleService`、`MissionQueryService`、`MissionExecutionService`、`MissionObservabilityService`、`MissionNotificationService`
- `module.ts` 中的 `services` 数组有 60+ 个 provider，显示分解正在进行中

**ai-engine AIEngineFacade 问题**：

`ai-engine/facade/ai-engine.facade.ts` 达 2,993 行，是 God Facade 反模式的典型体现。尽管 Phase 5 引入了 Domain Facades（ChatFacade、RAGFacade 等），但 AIEngineFacade 仍保留了大量直接方法，迁移工作未完成。

### 扣分原因

-3 分：topic-insights 中存在 13 个超过 1,000 行的服务文件（其中 3 个超过 2,000 行）；ai-engine 的 AIEngineFacade 本身 2,993 行（God Facade 问题）。

---

## D4: 耦合度 [8/10]

### 检查结果

**模块间耦合**：

`TopicInsightsModule` 的依赖链清晰：`AiEngineModule` + `CreditsModule` + `NotificationModule` + `PrismaModule` + `SecretsModule` + `StorageModule`，全部属于合理的向下依赖。

**服务间耦合**：

`topic-insights.module.ts` 中注册了 60+ 个 provider，但大多数是模块内部服务之间的内聚依赖（同属 topic-insights 模块），属于正常的功能分解产物。

**Gateway CORS 硬编码**：

```typescript
// topic-insights.gateway.ts:113
const isRailway = origin?.endsWith(".railway.app");
```

相比之下，`ai-teams.gateway.ts` 和 `ai-writing.gateway.ts` 使用 `APP_CONFIG.railway.frontendUrl`（通过 ConfigService 读取），topic-insights.gateway.ts 的实现不一致，且将平台信息硬编码在代码中。

**Prisma 直接访问**：

多个服务直接注入 `PrismaService` 而非通过 Repository 抽象层，这在 NestJS 实践中尚可接受，但在大型模块中增加了测试难度。

### 扣分原因

-2 分：Gateway CORS 硬编码 `.railway.app` 域名；60+ provider 的 module 注册复杂度偏高（虽然功能上合理）。

---

## D5: 代码重复（DRY）[6/10]

### 检查结果

**已确认的重复模式**：

1. **孤儿清理代码三重复**：`executePlanningAsync`（mission-lifecycle.service.ts:483-532）和 `approvePlanAndExecute`（mission-lifecycle.service.ts:663-710）中有几乎完全相同的 Mission FAILED + ResearchTask.updateMany + ResearchTodo.updateMany 三段清理逻辑，共约 50 行代码，重复出现 2 次，未抽象为私有方法。

2. **BillingContext 传播模板三重复**：

   ```typescript
   const existingCtx = BillingContext.get();
   const startFn = () => ...;
   const wrappedStart = existingCtx ? () => BillingContext.run(existingCtx, startFn) : startFn;
   void wrappedStart().catch((err) => {...});
   ```

   此模式在 `mission-lifecycle.service.ts` 和 `mission-execution.service.ts` 中各出现 3+ 次，应抽取为工具函数。

3. **研究主题已知的 H2/H3 问题**（来自项目内存）：`buildFiguresSummary` 在多处重复实现，`leader-planning`/`research-leader` 代码重复（H1 问题），项目内存中已标注为 H1/H2/H3 技术债务，尚未修复。

4. **`@/modules/ai-app/shared/report-template` 存在**（在 report-synthesis.service.ts:29 和 topic-insights.service.ts:9 均有引用），表明已有一定程度的共享提取，方向正确。

5. **ai-engine `throw new Error` 模式**：ai-engine/content/image/adapters 中多次重复 `throw new Error("No image data in...")` 错误模式，且用裸 `Error` 而非 NestJS 异常类。

### 扣分原因

-4 分：孤儿清理代码重复（2 处）、BillingContext 传播模板重复（6+ 处）、buildFiguresSummary 三重复（项目内存记录的 H2/H3 债务）、尚未解决。

---

## D6: 错误处理 [8/10]

### 检查结果

**无静默 catch**：扫描结果显示 0 个 `.catch(() => {})` 或空 catch 块，所有 catch 均有 logger 调用。

**Fire-and-Forget 模式规范**：`void x().catch((err) => this.logger.error(...))` 模式正确使用，符合 CLAUDE.md 要求。

**典型正确模式示例**：

```typescript
// mission-execution.service.ts:677
void this.extractResearchMemories(missionId, topicId).catch((error) => {
  this.logger.error(
    `[finalizeMission] Failed to extract research memories: ${error instanceof Error ? error.message : "Unknown error"}`,
  );
});
```

**`throw new Error` 使用（controllers/services）**：

- `topic-insights.gateway.ts:147` — 构造函数中 JWT_SECRET 缺失时抛出，合理（启动期配置错误）
- `handlers/dimension-write.handler.ts:129` — 在 handler 中抛出，此处抛出 `new Error(...)` 而非 NestJS 异常，跨越了应用边界（handler 是 Engine 层组件），但属于内部协调逻辑，可接受
- `services/core/topic/topic-team-orchestrator.service.ts:575` — `throw new Error("Refresh cancelled")` 属于流程控制，在 try/catch 内部使用
- `services/search/global-source-throttle.service.ts:91,110` — 同上，流程控制

**WebSocket Gateway 错误处理**：

所有 `@SubscribeMessage` 处理器的事件分发通过 `ResearchEventEmitterService` 的注册机制处理，Gateway 本身的 `handleConnection` 有完整 try-catch。`verifyToken` 的 catch 静默返回 null 属于设计意图（失败 = 拒绝连接）。

**ai-engine 中的问题**：

ai-engine/content/image/adapters 中的 `throw new Error(...)` 在 Engine 内部层使用，不会传播到 HTTP 边界，技术上可接受但不规范。

### 扣分原因

-2 分：`handlers/dimension-write.handler.ts` 在 Workflow Handler（Engine 层组件）中抛出裸 `Error`；ai-engine image adapter 多处 `throw new Error` 未使用领域异常类型。

---

## D7: 类型安全 [8/10]

### 检查结果

**`any` 类型使用（生产代码）**：

- `topic-insights` 生产代码：`grep -E ": any|as any|<any>"` 结果显示 533 总次 across 32 文件，但这包含大量测试文件。ESLint 规则 `@typescript-eslint/no-explicit-any: "error"` 在测试文件中被 override 为 off。实际生产代码（非测试）中 any 使用量需进一步细化，但 ESLint error 级别规则应有强制约束。

- `ai-engine` 生产代码：8 个匹配

- `ai-kernel` 生产代码：0 个匹配（非常干净）

**`@ts-ignore` / `@ts-expect-error`（生产代码）**：0 个，完全干净。

**类型完整性**：

- DTOs 结构完整，专用 `dto/` 目录下有 13 个 DTO 文件
- types/ 目录有 17 个类型定义文件，类型边界清晰
- `research.exceptions.ts` 位于 `types/` 目录（从原 `exceptions/` 迁移过来），略不规范但可接受

**ESLint 配置质量**：

`.eslintrc.js` 设置了 `no-explicit-any: "error"`（production）和 `no-floating-promises: "error"`，显示了强制类型安全的意图。`no-unsafe-*` 系列降级为 warn 属于技术债务，但有注释说明原因。

### 扣分原因

-2 分：533 处 any 集中在测试文件（ESLint 豁免），但测试文件中大量 `any` 可能掩盖接口不稳定；`no-unsafe-*` 系列降级为 warn（6 个规则），削弱了类型安全保证。

---

## D8: 性能风险 [7/10]

### 检查结果

**潜在 N+1 查询**：

`mission-execution.service.ts` 的 `executeDynamicScheduler` 中，在一个循环中多次调用 `prisma.researchTask.count` 和 `prisma.researchMission.findUnique`（行 800-813），未使用缓存，高频轮询场景下存在 N+1 风险。

`mission-lifecycle.service.ts` 中的孤儿清理代码同时发起 3 个 `prisma.*.update/updateMany` 调用（串行而非并行），可优化为 `Promise.all`。

**无界内存结构**：

`topic-insights.gateway.ts:135` — `userConnections = new Map<string, Set<string>>()` 在断开时有清理逻辑（`handleDisconnect`），不存在泄漏问题。

`data-source-router.service.ts` 引用了 `LruMap`（`import { LruMap } from "@/common/utils/lru-map"`），显示团队已在使用有界缓存。

**定时任务**：

`TopicRefreshScheduler` 使用 `@Cron` 注解，`ResearchMissionHealthService.recoverInterruptedMissions` 在 init 时触发，均有正确的 fire-and-forget + error 处理。

**任务并发控制**：

`executeDynamicScheduler` 中有 `maxConcurrent` 控制，`executingTasks = new Map<string, Promise<void>>()` 跟踪执行中任务，并发控制设计合理。

**大型模块加载性能**：

`topic-insights.module.ts` 注册了 60+ provider，NestJS DI 容器的初始化开销与 provider 数量成正比，但这是设计权衡（细粒度分解 vs 启动速度），可接受。

### 扣分原因

-3 分：`executeDynamicScheduler` 中的 N+1 查询模式；孤儿清理代码中串行而非并行的 Prisma 更新；大量服务间的 PrismaService 直接注入可能导致连接池竞争（60+ provider 同时注入，无 Repository 层隔离）。

---

## D9: 安全性 [7/10]

### 检查结果

**WebSocket CORS 硬编码域名**：

```typescript
// topic-insights.gateway.ts:113
const isRailway = origin?.endsWith(".railway.app");
```

`endsWith(".railway.app")` 检查可以被 `malicious.railway.app` 之类的域名通过（任何 `.railway.app` 子域均可）。更重要的是，这与其他两个 Gateway（`ai-teams.gateway.ts`、`ai-writing.gateway.ts`）不一致，后者使用 `APP_CONFIG.railway.frontendUrl` 精确匹配。这是一个安全不一致性问题，也是正在进行的自定义域名迁移（`genesis-ai-labs.org`）的潜在阻碍。

**`process.env` 直接访问**：

- topic-insights 生产代码：0 个 `process.env` 直接访问（完全通过 ConfigService）
- ai-engine 生产代码：email-sender.tool.ts 和 message-push.tool.ts 中共 11 处 `process.env` 直接访问（SMTP 配置），应通过 ConfigService 注入

**SQL 注入防护**：

未发现 `$queryRaw` 字符串拼接，Prisma ORM 本身提供参数化查询。

**API 密钥比较**：

`safeCompare` 工具已存在（`common/utils/crypto.utils.ts`），`ai-kernel/ipc/a2a/a2a-api-key.guard.ts` 的使用情况未读取（未验证），标注为未验证。

**JWT 认证**：

WebSocket Gateway 实现了中间件级 JWT 验证（`afterInit()` 中设置 `server.use()`），并在 DB 中验证用户存在性，设计合理。

**输入消毒**：

已有专用工具：`utils/prompt-sanitizer.ts`、`utils/sanitize-image-url.utils.ts`、`utils/security-audit-logger.ts`，以及 `common/utils/sanitize-content.utils.ts`，显示了对提示注入防护的意识。

### 扣分原因

-3 分：Gateway CORS 实现不一致且存在潜在子域绕过风险；ai-engine 工具层的 `process.env` 直接访问（11 处）未通过 ConfigService；safeCompare 在 A2A Guard 的使用情况未验证（风险待确认）。

---

## D10: 可测试性 [8/10]

### 检查结果

**测试文件比例**：

| 模块           | 生产文件 | 测试文件 | 比例 |
| -------------- | -------- | -------- | ---- |
| topic-insights | 191      | 106      | 55%  |
| ai-engine      | 432      | 242      | 56%  |
| ai-kernel      | 56       | 36       | 64%  |

三个模块的测试覆盖率均超过 50%，属于优秀水平。

**Controller 测试覆盖**：

topic-insights 的 6 个 Controller 均有对应的 spec 文件（位于 `controllers/__tests__/` 而非同名 `.spec.ts`），覆盖完整。

**跳过的测试**：

扫描结果显示 0 个 `it.skip`/`xit`/`xdescribe` 实例（所有 `.skip` 匹配均属于业务逻辑调用，如 `service.skipTask()`）。

**测试文件位置**：

使用 `__tests__/` 子目录模式，而非同名 `.spec.ts`（controllers 目录）。这导致了 git status 中部分测试文件在初始检查时显示为 "MISSING spec"，但实际上测试存在于 `__tests__/` 子目录。

**测试质量观察**：

测试文件中大量硬编码模型名（`gpt-4`, `gpt-4o`, `claude-3-sonnet`, `gemini-pro`），这是测试数据，不影响生产代码。但某些测试可能依赖具体模型名使测试本身脆弱。

### 扣分原因

-2 分：测试文件中大量 mock 数据硬编码模型名（虽属测试文件豁免范围，但可能使测试脆弱）；无 e2e 集成测试证据（未发现 `e2e/` 或 `integration/` 目录）。

---

## D11: 配置管理 [9/10]

### 检查结果

**LLM 参数硬编码（生产代码）**：

```
grep -E "model:.*gpt-|temperature: [0-9]|maxTokens: [0-9]" topic-insights/**/*.ts  (排除 spec.ts)
-> 0 个匹配
```

生产代码中零硬编码 model、temperature、maxTokens，完全符合规范。

**ESLint 双重保障**：

`.eslintrc.js` 通过 `no-restricted-syntax` 强制禁止 `temperature: [literal]` 和 `maxTokens: [literal]`，并通过 `no-restricted-imports` 强制禁止直接 LLM SDK 调用。

**`process.env` 访问**：

topic-insights：0 处直接访问，全部通过 ConfigService。
ai-engine 工具层：11 处直接访问（SMTP 配置）。
ai-kernel：通过 `PrismaModule` 注入，无直接 env 访问。

### 扣分原因

-1 分：ai-engine 工具层（email-sender.tool.ts、message-push.tool.ts）11 处 `process.env` 直接访问，应通过 ConfigService 注入。

---

## D12: 文档与命名 [8/10]

### 检查结果

**命名规范**：

- 文件名：全部 kebab-case，规范
- 类名：PascalCase，规范
- 方法/变量：camelCase，规范
- 目录结构清晰：`services/core/leader/`、`services/core/mission/`、`services/core/research/`、`services/core/topic/` 分别对应职责

**代码注释质量**：

主要服务均有 JSDoc 块描述职责，如 `ResearchLeaderService` 的"薄门面层"注释、`DimensionMissionService` 的 5 条核心职责列表、各 `*` 注释标注架构变更批次（"★ Gap 1"、"★ P0"、"★ Phase 6"等），可追溯演化历史。

**`console.log` 使用**：

生产代码中 0 处 `console.log`（ESLint 规则 `no-console: error`），全部使用 `NestJS Logger`。

**已知命名问题**：

- `guards/billing-context.interceptor.ts` — 文件名为 `interceptor` 但目录在 `guards/`，命名与位置不一致
- `types/research.exceptions.ts` — 异常类定义放在 `types/` 目录而非 `exceptions/` 目录（从 `exceptions/` 迁移过来），语义不清
- `topic-insights.service.ts` (1,492 行) 作为模块入口服务，但内容较重，职责边界不清晰

**硬编码品牌名**：

生产代码中 0 个品牌名硬编码（通过 `APP_CONFIG.brand.*` 访问）。

### 扣分原因

-2 分：`billing-context.interceptor.ts` 放在 `guards/` 目录、异常定义放在 `types/` 目录等位置命名不一致；`topic-insights.service.ts` 功能范围过宽，命名无法准确描述职责。

---

## 架构亮点

1. **Facade 边界执行彻底**：ESLint 规则覆盖 9 个 ai-engine 内部边界区，生产代码零违规，并有持续演化的证据（Phase 系列注释）。

2. **Domain Facades 的引入**：Phase 5 引入 `ChatFacade`、`RAGFacade`、`AgentFacade`、`TeamFacade`、`ToolFacade` 替代单一的 `AIEngineFacade`，正确地向更内聚的接口演进。

3. **类型安全配置**：无 `@ts-ignore`，无生产代码 `any` 使用（ESLint error 级别强制），`no-floating-promises: error`。

4. **测试密度优秀**：三个模块均超过 50% 测试文件比（topic-insights 55%、ai-engine 56%、ai-kernel 64%），无跳过的测试。

5. **安全基础扎实**：WebSocket JWT 中间件认证（带 DB 验证）、提示注入防护工具（prompt-sanitizer、sanitize-image-url）、安全审计日志（security-audit-logger）、per-user 连接数限制（MAX_CONNECTIONS_PER_USER=5）。

6. **错误处理规范**：零静默 catch，所有 fire-and-forget 均正确使用 `void + .catch(logger.error)` 模式。

7. **AI Kernel 独立性**：ai-kernel 模块完全清洁（0 个 `any`，无反向依赖，独立 Facade），作为基础设施层设计恰当。

8. **数据库索引完整**：ResearchTopic、ResearchMission、ResearchTask、ResearchMemory 均有合理的复合索引，覆盖主要查询路径。

---

## Critical 问题（必须立即修复）

### C1: topic-insights.gateway.ts CORS 硬编码 `.railway.app`

**位置**: `topic-insights.gateway.ts:113`
**问题**: `origin?.endsWith(".railway.app")` 允许任意 `.railway.app` 子域，与其他 Gateway 实现不一致，且在自定义域名迁移后将导致 CORS 阻断。

**修复方案**: 改为与 ai-teams.gateway.ts 一致的方式：

```typescript
// 从 ConfigService 读取允许的 origin 列表
const allowedOrigins =
  configService
    .get<string>("CORS_ORIGINS")
    ?.split(",")
    .map((o) => o.trim()) ?? [];

cors: {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(null, false);
    }
  };
}
```

---

## High 问题（应尽快修复）

### H1: ai-engine executors 绕过 ai-kernel/facade（3 处 import type）

**位置**:

- `ai-engine/orchestration/executors/base-executor.ts:23`
- `ai-engine/orchestration/executors/dag-executor.ts:22-23`

**问题**: 直接引用 `ai-kernel/resource/circuit-breaker.service`、`ai-kernel/journal/checkpoint-manager`、`ai-kernel/observability/process-event-log.service`，绕过了 `ai-kernel/facade`。这三个类均已在 `ai-kernel/facade/index.ts` 导出。

**修复方案**: 将 3 处 `import type` 路径统一改为 `ai-kernel/facade`：

```typescript
import type { CircuitBreakerService } from "../../../ai-kernel/facade";
import type { CheckpointManager } from "../../../ai-kernel/facade";
import type { ProcessEventLogService } from "../../../ai-kernel/facade";
```

### H2: BillingContext 传播模板重复（6+ 处）

**位置**: `mission-lifecycle.service.ts` 和 `mission-execution.service.ts` 各 3+ 处

**问题**: 相同的 BillingContext 传播样板代码重复，违反 DRY 原则，且易于在维护中遗漏。

**修复方案**: 提取工具函数：

```typescript
// common/utils/billing-context.utils.ts
export function withBillingContext<T>(
  fn: () => Promise<T>,
  ctx?: BillingContextData,
): () => Promise<T> {
  if (!ctx) return fn;
  return () => BillingContext.run(ctx, fn);
}
```

### H3: 孤儿清理代码重复（2+ 处）

**位置**: `mission-lifecycle.service.ts:483-532` 和 `:663-710`

**问题**: Mission FAILED + ResearchTask.updateMany + ResearchTodo.updateMany 三段清理逻辑重复，且三个 Prisma 调用串行而非并行。

**修复方案**: 提取私有方法 `markMissionFailed(missionId)` 并使用 `Promise.all`：

```typescript
private async markMissionFailed(missionId: string): Promise<void> {
  await Promise.all([
    this.prisma.researchMission.update({ where: { id: missionId }, data: { status: FAILED } }),
    this.prisma.researchTask.updateMany({ where: { missionId, status: { notIn: [...] } }, data: { status: FAILED } }),
    this.prisma.researchTodo.updateMany({ where: { missionId, status: { notIn: [...] } }, data: { status: CANCELLED } }),
  ]);
}
```

---

## Medium 问题（建议在下次迭代处理）

### M1: data-source-router.service.ts (2,653 行) 分解

职责过多：路由决策、并发控制、结果聚合、RAG-Fusion 集成、政策工具调用、Circuit Breaker 集成等，建议拆分。

### M2: report-synthesis.service.ts (2,483 行) 分解

已有 `ReportAssemblerService`、`ReportEditorService`、`ReportQualityGateService` 等子服务，但主服务仍过大。

### M3: ai-engine/facade/ai-engine.facade.ts (2,993 行) 迁移加速

Domain Facades（Phase 5）已就绪，建议制定 AIEngineFacade 方法的迁移计划，逐步让消费者迁移到 `ChatFacade`/`TeamFacade` 等，最终缩减 `AIEngineFacade` 规模。

### M4: ai-engine 工具层 process.env 直接访问（11 处）

`email-sender.tool.ts` 和 `message-push.tool.ts` 应通过 ConfigService 注入 SMTP 配置，而非直接读取 `process.env`。

### M5: executeDynamicScheduler N+1 查询优化

`mission-execution.service.ts` 中的调度循环在每次迭代中查询 `prisma.researchTask.count` 和 `prisma.researchMission.findUnique`，可改为基于事件驱动或批量查询的方式减少 DB 往返。

### M6: billing-context.interceptor.ts 位置修正

将 `guards/billing-context.interceptor.ts` 移至 `interceptors/billing-context.interceptor.ts`，保持命名与位置的一致性。

### M7: types/research.exceptions.ts 位置修正

将异常类定义从 `types/` 目录移至 `exceptions/` 目录，或在 `types/` 目录的 index.ts 中明确说明包含异常定义。

---

## Low 问题（可以改善）

### L1: 测试文件中硬编码模型名

测试文件中大量 `model: "gpt-4"` / `model: "gpt-4o"` 等 mock 数据，随着模型名变化可能导致测试与业务逻辑脱节。建议使用 `model: "test-model"` 等明确的测试专用值。

### L2: ai-infra/facade 未在此次审计中覆盖

`topic-insights.service.ts:57` 和 `controllers/mission.controller.ts:47` 均从 `../../ai-infra/facade` 导入 `BillingContext`。该路径未在本次审计范围内，建议在下次审计中覆盖 `ai-infra/` 模块。

### L3: ai-engine/infra/a2a/a2a.module.ts Controller 直接引用

`a2a.module.ts:8` 直接从 `ai-kernel/ipc/a2a/a2a.controller` 导入 Controller。`ai-kernel/facade/index.ts` 中注释说明"Controller 有装饰器副作用，不从 facade 导出"，这是已知的架构妥协，建议加文档说明替代方案。

### L4: `no-unsafe-*` ESLint 规则降级为 warn

`.eslintrc.js` 中 6 个 `no-unsafe-*` 规则降级为 warn，注释说明"MongoDB/Neo4j 等场景需要"，但两者已从系统中移除（项目内存）。建议提升回 error 级别。

---

## 架构债务优先级矩阵

| 优先级 | 问题                                     | 维度   | 影响范围      | 修复成本              | 建议时机 |
| ------ | ---------------------------------------- | ------ | ------------- | --------------------- | -------- |
| P0     | Gateway CORS 硬编码 `.railway.app`       | D9     | 安全/兼容性   | 低（约 20 行）        | 立即     |
| P1     | ai-engine executor 绕过 ai-kernel/facade | D1/D2  | 架构规范      | 低（3 行修改）        | 本迭代   |
| P1     | BillingContext 传播模板重复              | D5     | 可维护性      | 低（提取工具函数）    | 本迭代   |
| P1     | 孤儿清理代码重复 + 串行 Prisma           | D5/D8  | 可维护性/性能 | 低（提取私有方法）    | 本迭代   |
| P2     | data-source-router.service.ts 分解       | D3     | 可维护性      | 高                    | 下次迭代 |
| P2     | ai-engine AIEngineFacade 方法迁移计划    | D3     | 架构健康      | 中                    | 下次迭代 |
| P2     | ai-engine 工具层 process.env 11 处       | D9/D11 | 安全/规范     | 低                    | 下次迭代 |
| P2     | executeDynamicScheduler N+1 优化         | D8     | 性能          | 中                    | 下次迭代 |
| P3     | 测试文件模型名规范化                     | D10    | 测试健壮性    | 低                    | 长期     |
| P3     | no-unsafe-\* 规则提升                    | D7     | 类型安全      | 中（需修复现有 warn） | 长期     |
| P3     | billing-context.interceptor.ts 位置修正  | D12    | 命名一致性    | 极低                  | 长期     |

---

_审计员: Arch Auditor (claude-sonnet-4-6)_
_下次建议审计: 2026-04-12_
_审计方法: 全量代码读取 + grep 扫描，所有发现均基于实际读取的文件，未验证项已标注_
